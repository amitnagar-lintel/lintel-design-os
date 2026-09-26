/**
 * The action vocabulary (D4). Exactly the 46 actions seeded in design_os.permission (migration 0002); a database
 * test asserts parity. The API guard checks the same strings that RLS and the SECURITY DEFINER functions check —
 * there is no second permission vocabulary, and code never checks a role name.
 */
export const PERMISSION_ACTIONS = [
  "org.members.manage",
  "org.role_permissions.manage",
  "audit.read",
  "reference.read",
  "client.read",
  "client.write",
  "project.read_all",
  "project.write",
  "project_members.assign",
  "room.survey.write",
  "design_version.author",
  "design_version.approve",
  "design_version.lock",
  "output.generate.engineering",
  "output.generate.commercial",
  "quotation.issue",
  "drawing.issue",
  "manufacturing.release",
  "output.read.cost",
  "output.read.production",
  "output.read.issued",
  "construction_standard.author",
  "construction_standard.approve",
  "planning_standard.author",
  "planning_standard.approve",
  "edge_band_standard.author",
  "edge_band_standard.approve",
  "manufacturing_standard.author",
  "manufacturing_standard.approve",
  "pricing_standard.author",
  "pricing_standard.approve",
  "quotation_policy.author",
  "quotation_policy.approve",
  "commercial_config.approve",
  "material_catalog.author",
  "material_catalog.approve",
  "finish_catalog.author",
  "finish_catalog.approve",
  "hardware_catalog.author",
  "hardware_catalog.approve",
  "appliance_catalog.author",
  "appliance_catalog.approve",
  "product_catalog.author",
  "product_catalog.approve",
  "hettich.author",
  "hettich.approve",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export function isPermissionAction(v: string): v is PermissionAction {
  return (PERMISSION_ACTIONS as readonly string[]).includes(v);
}
