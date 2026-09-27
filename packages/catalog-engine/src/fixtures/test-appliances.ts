import type { Appliance } from "@lintel/types";

/**
 * TEST FIXTURE — synthetic appliances used only to exercise engine mechanics in tests and golden fixtures
 * (Design Studio Slice 5 step 2, `docs/architecture/DESIGN-STUDIO-SLICE-5-SPECIAL-CABINETS.md` §5). These are
 * NOT real manufacturer dimensions. Status TEST_FIXTURE is never approvable: the persistence layer always
 * refuses to write it (`TestFixturePersistenceError`), exactly like every other TEST_FIXTURE_* constant here.
 * No real appliance dimensions are invented (CLAUDE.md); every value here is a synthetic placeholder for
 * development only, deliberately unlike any real manufacturer's published spec.
 */
export const TEST_FIXTURE_APPLIANCES: readonly Appliance[] = [
  {
    applianceId: "TEST_FIXTURE_HOB",
    category: "HOB",
    make: null,
    model: null,
    dimensions: { widthMm: 590, heightMm: 55, depthMm: 510 },
    installation: {
      widthMm: 560,
      heightMm: 55,
      depthMm: 490,
      clearances: [
        { ruleId: "TEST_FIXTURE_HOB_SIDE", zone: "INSTALLATION", axis: "LEFT", minMm: 50, maxMm: null },
        { ruleId: "TEST_FIXTURE_HOB_SIDE_R", zone: "INSTALLATION", axis: "RIGHT", minMm: 50, maxMm: null },
      ],
    },
    ventilation: [{ ruleId: "TEST_FIXTURE_HOB_VENT_BELOW", zone: "VENTILATION", axis: "BOTTOM", minMm: 20, maxMm: null }],
    frontAlignment: null,
    status: "TEST_FIXTURE",
    source: "Test fixture (synthetic)",
  },
  {
    applianceId: "TEST_FIXTURE_OVEN",
    category: "OVEN",
    make: null,
    model: null,
    dimensions: { widthMm: 595, heightMm: 595, depthMm: 550 },
    installation: {
      widthMm: 560,
      heightMm: 585,
      depthMm: 550,
      clearances: [{ ruleId: "TEST_FIXTURE_OVEN_TOP", zone: "INSTALLATION", axis: "TOP", minMm: 5, maxMm: 5 }],
    },
    ventilation: null,
    frontAlignment: "FLUSH",
    status: "TEST_FIXTURE",
    source: "Test fixture (synthetic)",
  },
];
