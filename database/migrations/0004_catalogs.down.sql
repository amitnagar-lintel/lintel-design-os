-- 0004 down
SET LOCAL ROLE design_os_owner;
DROP TABLE design_os.product_catalog_version_product;
DROP TABLE design_os.appliance_catalog_version_appliance;
DROP TABLE design_os.hardware_catalog_version_hardware_rule_set;
DROP TABLE design_os.hardware_catalog_version_hardware_item;
DROP TABLE design_os.finish_catalog_version_finish;
DROP TABLE design_os.material_catalog_version_edge_band;
DROP TABLE design_os.material_catalog_version_material;
DROP TABLE design_os.product_catalog_version;
DROP TABLE design_os.appliance_catalog_version;
DROP TABLE design_os.hardware_catalog_version;
DROP TABLE design_os.finish_catalog_version;
DROP TABLE design_os.material_catalog_version;
DROP FUNCTION design_os.create_catalog_member_table(text, text);
DROP FUNCTION design_os.create_catalog_version_table(text);
DROP TABLE design_os.product_version;
DROP FUNCTION design_os.guard_product_recipe();
DROP TABLE design_os.recipe_version;
DROP TABLE design_os.appliance_version;
DROP TABLE design_os.hardware_rule;
DROP TABLE design_os.hardware_rule_set_version;
DROP TABLE design_os.hardware_item_version;
DROP TABLE design_os.finish_material_compatibility;
DROP TABLE design_os.finish_version;
ALTER TABLE design_os.edge_band_rule DROP CONSTRAINT edge_band_rule_band_fk;
DROP TABLE design_os.edge_band_version;
DROP TABLE design_os.material_version;
DELETE FROM design_os.versioned_table WHERE subject_type IN ('material', 'edge_band', 'finish', 'hardware_item', 'hardware_rule_set', 'appliance', 'construction_recipe', 'product',
  'material_catalog', 'finish_catalog', 'hardware_catalog', 'appliance_catalog', 'product_catalog');
DROP TABLE design_os.product_catalog, design_os.appliance_catalog, design_os.hardware_catalog, design_os.finish_catalog, design_os.material_catalog,
  design_os.product, design_os.construction_recipe, design_os.appliance, design_os.hardware_rule_set, design_os.hardware_item, design_os.finish, design_os.edge_band, design_os.material;
DROP FUNCTION design_os.create_entity_table(text);
