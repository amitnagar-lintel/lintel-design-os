-- 0002 tenancy and access: organizations, users, roles, action permissions, memberships,
-- clients, client contacts, projects and project members (M5 §2.2, §7, §9, D4, D9, D10).

-- app_user.id references the Supabase Auth user (auth.users.id).
GRANT USAGE ON SCHEMA auth TO design_os_owner;
GRANT SELECT, REFERENCES ON auth.users TO design_os_owner;

SET LOCAL ROLE design_os_owner;

CREATE TABLE design_os.organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  -- Reserved for corporate → branch → franchise (PRD §40). Unused in V1.
  parent_org_id uuid REFERENCES design_os.organization (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Identity = Supabase Auth user. identity_kind is fixed at creation: INTERNAL (company route) or CLIENT (passwordless route).
CREATE TABLE design_os.app_user (
  id uuid PRIMARY KEY REFERENCES auth.users (id),
  email text NOT NULL,
  display_name text NOT NULL,
  identity_kind design_os.identity_kind NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_email_unique ON design_os.app_user (lower(email));

CREATE FUNCTION design_os.guard_identity_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.identity_kind IS DISTINCT FROM OLD.identity_kind THEN
    RAISE EXCEPTION 'design_os.app_user: identity_kind is fixed at creation' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_identity_kind BEFORE UPDATE ON design_os.app_user FOR EACH ROW EXECUTE FUNCTION design_os.guard_identity_kind();

CREATE TABLE design_os.role (
  code design_os.design_os_role PRIMARY KEY,
  description text NOT NULL
);

-- Action-based permissions (D4): code checks actions, never role names.
CREATE TABLE design_os.permission (
  action text PRIMARY KEY,
  description text NOT NULL
);

ALTER TABLE design_os.versioned_table
  ADD CONSTRAINT versioned_table_author_fk FOREIGN KEY (author_action) REFERENCES design_os.permission (action),
  ADD CONSTRAINT versioned_table_approve_fk FOREIGN KEY (approve_action) REFERENCES design_os.permission (action);

-- Actions a CLIENT identity may ever hold (D10). Anything else is refused by constraint.
CREATE FUNCTION design_os.client_allowed_actions() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['output.read.issued'] $$;

-- Finance approvals belong to FINANCE only (D9); COSTING never approves its own pricing.
CREATE FUNCTION design_os.finance_approval_actions() RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT ARRAY['pricing_standard.approve', 'quotation_policy.approve', 'commercial_config.approve'] $$;

-- Defaults copied to each new organization; changes per org are audited data (role_permission).
CREATE TABLE design_os.default_role_permission (
  role design_os.design_os_role NOT NULL REFERENCES design_os.role (code),
  action text NOT NULL REFERENCES design_os.permission (action),
  PRIMARY KEY (role, action),
  CONSTRAINT default_finance_only CHECK (action <> ALL (design_os.finance_approval_actions()) OR role = 'FINANCE'),
  CONSTRAINT default_client_whitelist CHECK (role <> 'CLIENT' OR action = ANY (design_os.client_allowed_actions()))
);

CREATE TABLE design_os.role_permission (
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  role design_os.design_os_role NOT NULL REFERENCES design_os.role (code),
  action text NOT NULL REFERENCES design_os.permission (action),
  granted_by uuid REFERENCES design_os.app_user (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role, action),
  CONSTRAINT role_permission_finance_only CHECK (action <> ALL (design_os.finance_approval_actions()) OR role = 'FINANCE'),
  CONSTRAINT role_permission_client_whitelist CHECK (role <> 'CLIENT' OR action = ANY (design_os.client_allowed_actions()))
);

CREATE FUNCTION design_os.seed_org_permissions() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO design_os.role_permission (org_id, role, action) SELECT NEW.id, role, action FROM design_os.default_role_permission;
  RETURN NEW;
END $$;
CREATE TRIGGER seed_org_permissions AFTER INSERT ON design_os.organization FOR EACH ROW EXECUTE FUNCTION design_os.seed_org_permissions();

CREATE TABLE design_os.org_membership (
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  user_id uuid NOT NULL REFERENCES design_os.app_user (id),
  role design_os.design_os_role NOT NULL REFERENCES design_os.role (code),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_by uuid REFERENCES design_os.app_user (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, role)
);

-- CLIENT identities hold only the CLIENT role; internal roles need an INTERNAL identity (D10).
CREATE FUNCTION design_os.guard_membership_identity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  kind design_os.identity_kind;
BEGIN
  SELECT identity_kind INTO kind FROM design_os.app_user WHERE id = NEW.user_id;
  IF (NEW.role = 'CLIENT') <> (kind = 'CLIENT') THEN
    RAISE EXCEPTION 'design_os.org_membership: role % requires a % identity (user is %)', NEW.role, CASE WHEN NEW.role = 'CLIENT' THEN 'CLIENT' ELSE 'INTERNAL' END, kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_membership_identity BEFORE INSERT OR UPDATE ON design_os.org_membership FOR EACH ROW EXECUTE FUNCTION design_os.guard_membership_identity();

CREATE TABLE design_os.client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  client_code text NOT NULL,
  name text NOT NULL,
  contact jsonb,
  -- Text references to lintel-os-ops only (D7): no cross-database foreign keys, no synchronisation.
  ops_client_ref text,
  ops_lead_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_code_unique UNIQUE (org_id, client_code),
  CONSTRAINT client_org_id_unique UNIQUE (org_id, id)
);

-- A client identity: created by internal staff only; linked to an auth user on first passwordless sign-in.
CREATE TABLE design_os.client_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  client_id uuid NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  user_id uuid REFERENCES design_os.app_user (id),
  status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'ACTIVE', 'REVOKED')),
  invited_by uuid NOT NULL REFERENCES design_os.app_user (id),
  invited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_contact_client_fk FOREIGN KEY (org_id, client_id) REFERENCES design_os.client (org_id, id),
  CONSTRAINT client_contact_org_id_unique UNIQUE (org_id, id),
  CONSTRAINT client_contact_active_needs_user CHECK (status <> 'ACTIVE' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX client_contact_email_unique ON design_os.client_contact (org_id, lower(email));

CREATE FUNCTION design_os.guard_client_contact_identity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND (SELECT identity_kind FROM design_os.app_user WHERE id = NEW.user_id) <> 'CLIENT' THEN
    RAISE EXCEPTION 'design_os.client_contact: a contact can only be linked to a CLIENT identity' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_client_contact_identity BEFORE INSERT OR UPDATE ON design_os.client_contact FOR EACH ROW EXECUTE FUNCTION design_os.guard_client_contact_identity();

CREATE TABLE design_os.project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES design_os.organization (id),
  client_id uuid NOT NULL,
  project_code text NOT NULL,
  name text NOT NULL,
  site_address jsonb,
  status text NOT NULL DEFAULT 'ACTIVE',
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  unit_system text NOT NULL DEFAULT 'MM' CHECK (unit_system = 'MM'),
  ops_project_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_client_fk FOREIGN KEY (org_id, client_id) REFERENCES design_os.client (org_id, id),
  CONSTRAINT project_code_unique UNIQUE (org_id, project_code),
  CONSTRAINT project_org_id_unique UNIQUE (org_id, id)
);

CREATE TABLE design_os.project_member (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES design_os.app_user (id),
  role design_os.design_os_role NOT NULL REFERENCES design_os.role (code),
  client_contact_id uuid,
  granted_by uuid NOT NULL REFERENCES design_os.app_user (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, role),
  CONSTRAINT project_member_project_fk FOREIGN KEY (org_id, project_id) REFERENCES design_os.project (org_id, id),
  CONSTRAINT project_member_contact_fk FOREIGN KEY (org_id, client_contact_id) REFERENCES design_os.client_contact (org_id, id),
  CONSTRAINT project_member_contact_iff_client CHECK ((role = 'CLIENT') = (client_contact_id IS NOT NULL)),
  CONSTRAINT project_member_not_self_granted CHECK (granted_by <> user_id)
);

-- A CLIENT member must be the ACTIVE contact of the project's own client; everyone else must be an
-- active internal member of the same organization (D10: a project id alone never grants anything).
CREATE FUNCTION design_os.guard_project_member() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.role = 'CLIENT' THEN
    SELECT EXISTS (
      SELECT 1 FROM design_os.client_contact cc JOIN design_os.project p ON p.id = NEW.project_id AND p.org_id = NEW.org_id
      WHERE cc.id = NEW.client_contact_id AND cc.org_id = NEW.org_id AND cc.client_id = p.client_id AND cc.user_id = NEW.user_id AND cc.status = 'ACTIVE'
    ) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'design_os.project_member: a CLIENT member must be an ACTIVE contact of this project''s client' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM design_os.org_membership m JOIN design_os.app_user u ON u.id = m.user_id
      WHERE m.org_id = NEW.org_id AND m.user_id = NEW.user_id AND m.status = 'ACTIVE' AND u.identity_kind = 'INTERNAL'
    ) INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'design_os.project_member: % members must be active internal members of the organization', NEW.role USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_project_member BEFORE INSERT OR UPDATE ON design_os.project_member FOR EACH ROW EXECUTE FUNCTION design_os.guard_project_member();

-- ---------------------------------------------------------------- access helpers (used by RLS, 0010)

-- The org named in the claims, accepted only if the caller is an active member of it (never trusted blindly, PRD §39).
CREATE FUNCTION design_os.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT m.org_id FROM design_os.org_membership m JOIN design_os.app_user u ON u.id = m.user_id
    WHERE m.user_id = design_os.current_user_id() AND m.org_id = nullif(design_os.claims() ->> 'org_id', '')::uuid
      AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
    LIMIT 1
  $$;

CREATE FUNCTION design_os.is_internal() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$ SELECT coalesce((SELECT identity_kind = 'INTERNAL' AND status = 'ACTIVE' FROM design_os.app_user WHERE id = design_os.current_user_id()), false) $$;

CREATE FUNCTION design_os.has_permission(p_action text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM design_os.org_membership m JOIN design_os.role_permission rp ON rp.org_id = m.org_id AND rp.role = m.role
      WHERE m.org_id = design_os.current_org_id() AND m.user_id = design_os.current_user_id() AND m.status = 'ACTIVE' AND rp.action = p_action
    )
  $$;

CREATE FUNCTION design_os.can_access_project(p_project uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = design_os, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM design_os.project p
      WHERE p.id = p_project AND p.org_id = design_os.current_org_id() AND (
        (design_os.is_internal() AND (
          design_os.has_permission('project.read_all')
          OR EXISTS (SELECT 1 FROM design_os.project_member pm WHERE pm.project_id = p.id AND pm.user_id = design_os.current_user_id() AND pm.role <> 'CLIENT')))
        OR (NOT design_os.is_internal() AND EXISTS (
          SELECT 1 FROM design_os.project_member pm JOIN design_os.client_contact cc ON cc.id = pm.client_contact_id
          WHERE pm.project_id = p.id AND pm.user_id = design_os.current_user_id() AND pm.role = 'CLIENT'
            AND cc.status = 'ACTIVE' AND cc.client_id = p.client_id AND cc.user_id = design_os.current_user_id())))
    )
  $$;

-- ---------------------------------------------------------------- seeds: roles, actions, default grants (M5 §9)

INSERT INTO design_os.role (code, description) VALUES
  ('ADMIN', 'Administrative authority: members, role grants, audit. Does not perform normal finance approvals.'),
  ('DESIGNER', 'Creates and edits DRAFT rooms, designs, objects and overrides; submits.'),
  ('DESIGN_HEAD', 'Approves design versions; locks/issues drawings; technical standards and catalogs.'),
  ('SALES', 'Clients, projects and client access; issues quotations.'),
  ('COSTING', 'Generates pricing and quotations; authors pricing standards and quotation policies (never approves them).'),
  ('FINANCE', 'Approves PricingStandard, Finance/QuotationPolicy and finance-related commercial configuration.'),
  ('PROCUREMENT', 'Authors material, finish, appliance, hardware and Hettich catalog data.'),
  ('PRODUCTION', 'Technical standards, hardware/Hettich approval, release to manufacturing.'),
  ('SITE_ENGINEER', 'Room surveys; reads production drawings of assigned projects.'),
  ('CLIENT', 'External client contact: issued quotations and drawings of own projects only.');

INSERT INTO design_os.permission (action, description) VALUES
  ('org.members.manage', 'Manage organization memberships'),
  ('org.role_permissions.manage', 'Change role → action grants'),
  ('audit.read', 'Read audit history'),
  ('reference.read', 'Read standards, catalogs and Hettich data'),
  ('client.read', 'Read clients and client contacts'),
  ('client.write', 'Create/edit clients and invite/revoke client contacts'),
  ('project.read_all', 'Access every project of the organization'),
  ('project.write', 'Create/edit projects'),
  ('project_members.assign', 'Assign project members (including CLIENT contacts)'),
  ('room.survey.write', 'Create rooms and room survey revisions'),
  ('design_version.author', 'Create/edit DRAFT designs, objects, overrides; submit'),
  ('design_version.approve', 'Approve / request changes on design versions'),
  ('design_version.lock', 'Lock design versions'),
  ('output.generate.engineering', 'Generate BOM, BOQ and drawing snapshots and validation runs'),
  ('output.generate.commercial', 'Generate pricing and quotation snapshots'),
  ('quotation.issue', 'Issue a quotation to the client (locks the design version)'),
  ('drawing.issue', 'Issue drawings (locks the design version)'),
  ('manufacturing.release', 'Release to manufacturing (locks the design version)'),
  ('output.read.cost', 'Read internal cost breakdowns (pricing snapshots)'),
  ('output.read.production', 'Read BOM, BOQ, drawings and manufacturing documents'),
  ('output.read.issued', 'Read issued quotations and issued drawings'),
  ('construction_standard.author', 'Author ConstructionStandard versions'),
  ('construction_standard.approve', 'Approve ConstructionStandard versions'),
  ('planning_standard.author', 'Author PlanningStandard versions'),
  ('planning_standard.approve', 'Approve PlanningStandard versions'),
  ('edge_band_standard.author', 'Author EdgeBandStandard versions'),
  ('edge_band_standard.approve', 'Approve EdgeBandStandard versions'),
  ('manufacturing_standard.author', 'Author ManufacturingStandard versions'),
  ('manufacturing_standard.approve', 'Approve ManufacturingStandard versions'),
  ('pricing_standard.author', 'Author PricingStandard versions'),
  ('pricing_standard.approve', 'Approve PricingStandard versions (FINANCE only)'),
  ('quotation_policy.author', 'Author Finance/QuotationPolicy versions'),
  ('quotation_policy.approve', 'Approve Finance/QuotationPolicy versions (FINANCE only)'),
  ('commercial_config.approve', 'Approve finance-related commercial configuration (FINANCE only)'),
  ('material_catalog.author', 'Author material and edge band items and material catalog versions'),
  ('material_catalog.approve', 'Approve material/edge band items and material catalog versions'),
  ('finish_catalog.author', 'Author finish items and finish catalog versions'),
  ('finish_catalog.approve', 'Approve finish items and finish catalog versions'),
  ('hardware_catalog.author', 'Author hardware items, hardware rule sets and hardware catalog versions'),
  ('hardware_catalog.approve', 'Approve hardware items, rule sets and hardware catalog versions'),
  ('appliance_catalog.author', 'Author appliance items and appliance catalog versions'),
  ('appliance_catalog.approve', 'Approve appliance items and appliance catalog versions'),
  ('product_catalog.author', 'Author products, construction recipes and product catalog versions'),
  ('product_catalog.approve', 'Approve products, construction recipes and product catalog versions'),
  ('hettich.author', 'Author Hettich dataset versions (source-verified records only)'),
  ('hettich.approve', 'Approve Hettich dataset versions');

INSERT INTO design_os.default_role_permission (role, action)
SELECT r::design_os.design_os_role, a FROM (VALUES
  ('ADMIN', ARRAY['org.members.manage', 'org.role_permissions.manage', 'audit.read', 'reference.read', 'client.read', 'client.write', 'project.read_all', 'project.write', 'project_members.assign', 'output.read.cost', 'output.read.production', 'output.read.issued']),
  ('DESIGNER', ARRAY['reference.read', 'client.read', 'room.survey.write', 'design_version.author', 'output.generate.engineering', 'output.read.production', 'output.read.issued']),
  ('DESIGN_HEAD', ARRAY['reference.read', 'client.read', 'client.write', 'project.read_all', 'project.write', 'project_members.assign', 'room.survey.write', 'design_version.author', 'design_version.approve', 'design_version.lock', 'output.generate.engineering', 'drawing.issue', 'output.read.cost', 'output.read.production', 'output.read.issued', 'audit.read',
    'construction_standard.author', 'construction_standard.approve', 'planning_standard.author', 'planning_standard.approve', 'edge_band_standard.approve', 'manufacturing_standard.approve',
    'material_catalog.author', 'material_catalog.approve', 'finish_catalog.author', 'finish_catalog.approve', 'appliance_catalog.author', 'appliance_catalog.approve', 'hardware_catalog.approve', 'hettich.approve', 'product_catalog.author', 'product_catalog.approve']),
  ('SALES', ARRAY['reference.read', 'client.read', 'client.write', 'project.read_all', 'project.write', 'project_members.assign', 'quotation.issue', 'output.read.issued']),
  ('COSTING', ARRAY['reference.read', 'client.read', 'output.generate.engineering', 'output.generate.commercial', 'pricing_standard.author', 'quotation_policy.author', 'output.read.cost', 'output.read.production', 'output.read.issued']),
  ('FINANCE', ARRAY['reference.read', 'client.read', 'pricing_standard.approve', 'quotation_policy.approve', 'commercial_config.approve', 'output.read.cost', 'output.read.issued', 'audit.read']),
  ('PROCUREMENT', ARRAY['reference.read', 'material_catalog.author', 'finish_catalog.author', 'appliance_catalog.author', 'hardware_catalog.author', 'hettich.author', 'output.read.cost', 'output.read.production']),
  ('PRODUCTION', ARRAY['reference.read', 'construction_standard.author', 'construction_standard.approve', 'planning_standard.author', 'planning_standard.approve', 'edge_band_standard.author', 'edge_band_standard.approve', 'manufacturing_standard.author', 'manufacturing_standard.approve',
    'material_catalog.approve', 'finish_catalog.approve', 'appliance_catalog.approve', 'hardware_catalog.author', 'hardware_catalog.approve', 'hettich.author', 'hettich.approve', 'product_catalog.approve', 'manufacturing.release', 'output.read.production', 'output.read.issued']),
  ('SITE_ENGINEER', ARRAY['reference.read', 'room.survey.write', 'output.read.production', 'output.read.issued']),
  ('CLIENT', ARRAY['output.read.issued'])
) AS g(r, actions), unnest(actions) AS a;
