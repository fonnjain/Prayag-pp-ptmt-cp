/**
 * Immutable August 2026 manual-plan evidence.
 *
 * These values are copied from Prayag's August planning exports. They are
 * intentionally local fixtures: the live workbooks are mutable and must not
 * make the regression suite nondeterministic.
 */

export type AugustWorkbookProvenance = {
  workbookName: string;
  driveId: string;
  modifiedTime: string;
};

/**
 * Source metadata captured with the fixture values on 2026-08-25.
 * If a workbook changes, refresh the values and this provenance together.
 */
export const AUGUST_WORKBOOK_PROVENANCE: Record<"PTMT" | "Plumbing", AugustWorkbookProvenance> = {
  PTMT: {
    workbookName: "Daily Production PTMT AUG' 2026",
    driveId: "1jy-T1ou7r67rWE8O_I6plrbJGXRlxnL0zJbJifHTqLc",
    modifiedTime: "2026-08-25T14:11:27.104Z",
  },
  Plumbing: {
    workbookName: "Daily Production PLUMBING AUG ' 2026",
    driveId: "1XIphSUrftEKRR93GyUF_XsE5yKWQhjeKUKCpx9IeO_U",
    modifiedTime: "2026-08-25T12:53:56.054Z",
  },
};

/**
 * Baseline notes for the August comparison. Plumbing's two figures are
 * intentionally both recorded because the pending-order decision is still
 * open: the fixture comparison uses the pending-fixed state, while the live
 * pending state remains a separate diagnostic baseline.
 */
export const AUGUST_PLAN_BASELINES = {
  PTMT: {
    pendingFixedGrandMax: 617_566.27,
  },
  Plumbing: {
    pendingFixedGrandMax: 2_447_569.10,
    livePendingGrandMax: 2_591_466,
  },
} as const;

export type AugustCategoryFixture = {
  category: string;
  minTotal: number;
  maxTotal: number;
  multiplier: number;
};

export type AugustItemFixture = {
  itemCode: string;
  colour: string;
  category: string;
  avg3MoSale: number;
  pending: number;
  pendingLastMo: number;
  bufferReq: number;
  stock: number;
  prayagPlan: number;
};

export const PTMT_AUGUST_CATEGORY_FIXTURES: AugustCategoryFixture[] = [
  { category: "Cocks Standard", minTotal: 210_513, maxTotal: 392_794, multiplier: 1.5 },
  { category: "Cocks Premium", minTotal: 10_369, maxTotal: 16_120, multiplier: 1.2 },
  { category: "Faucets & Jetsprays & Shower", minTotal: 36_020, maxTotal: 66_974, multiplier: 1.5 },
  { category: "Accessorise", minTotal: 20_011, maxTotal: 37_506, multiplier: 1.5 },
  { category: "Cistern & Seat Cover", minTotal: 22_388, maxTotal: 38_522, multiplier: 1.2 },
  { category: "Cabinet", minTotal: 931, maxTotal: 2_261, multiplier: 1.2 },
  { category: "Ball Cock", minTotal: 34_918, maxTotal: 63_833, multiplier: 1.5 },
];

export const PLUMBING_AUGUST_CATEGORY_FIXTURES: AugustCategoryFixture[] = [
  { category: "CPVC Pipe", minTotal: 87_558, maxTotal: 160_466.5, multiplier: 1.5 },
  { category: "CPVC Fitting", minTotal: 452_204, maxTotal: 843_883.5, multiplier: 1.5 },
  { category: "CPVC Solvent", minTotal: 10_067, maxTotal: 24_338, multiplier: 1.5 },
  { category: "UPVC Pipe", minTotal: 51_220, maxTotal: 92_689.9, multiplier: 1.2 },
  { category: "UPVC Fitting", minTotal: 404_911, maxTotal: 825_209.5, multiplier: 1.5 },
  { category: "UPVC Solvent", minTotal: 108, maxTotal: 541, multiplier: 1.5 },
  { category: "SWR Pipe", minTotal: 43_790, maxTotal: 75_647, multiplier: 1 },
  { category: "SWR Fitting", minTotal: 145_515, maxTotal: 239_149.6, multiplier: 1.2 },
  { category: "SWR Solvent", minTotal: 1_086, maxTotal: 1_086, multiplier: 1 },
  { category: "AGRI Pipe", minTotal: 8_309, maxTotal: 16_362, multiplier: 1.5 },
  { category: "AGRI Fitting", minTotal: 26_963, maxTotal: 51_442.5, multiplier: 1.5 },
  { category: "AGRI Solvent", minTotal: 0, maxTotal: 0, multiplier: 1.5 },
];

export const PTMT_AUGUST_ITEM_FIXTURES: AugustItemFixture[] = [
  {
    itemCode: "120-WS",
    colour: "WHITE",
    category: "Cocks Standard",
    avg3MoSale: 23_870,
    pending: 0,
    pendingLastMo: 3_072,
    bufferReq: 26_257,
    stock: 0,
    prayagPlan: 29_329,
  },
  {
    itemCode: "144",
    colour: "IVORY",
    category: "Cocks Standard",
    avg3MoSale: 25_240,
    pending: 0,
    pendingLastMo: 0,
    bufferReq: 27_764,
    stock: 71,
    prayagPlan: 27_693,
  },
  {
    itemCode: "121",
    colour: "IVORY",
    category: "Cocks Standard",
    avg3MoSale: 21_574,
    pending: 0,
    pendingLastMo: 12_932,
    bufferReq: 23_731,
    stock: 0,
    prayagPlan: 36_663,
  },
  {
    itemCode: "121",
    colour: "WHITE",
    category: "Cocks Standard",
    avg3MoSale: 18_467,
    pending: 0,
    pendingLastMo: 0,
    bufferReq: 20_314,
    stock: 35_217,
    prayagPlan: -14_903,
  },
  {
    itemCode: "144",
    colour: "WHITE",
    category: "Cocks Standard",
    avg3MoSale: 18_780,
    pending: 0,
    pendingLastMo: 0,
    bufferReq: 20_658,
    stock: 8_545,
    prayagPlan: 12_113,
  },
  {
    itemCode: "120-WS",
    colour: "IVORY",
    category: "Cocks Standard",
    avg3MoSale: 12_270,
    pending: 0,
    pendingLastMo: 0,
    bufferReq: 13_497,
    stock: 2_137,
    prayagPlan: 11_360,
  },
  {
    itemCode: "121-O",
    colour: "WHITE",
    category: "Cocks Standard",
    avg3MoSale: 10_811,
    pending: 0,
    pendingLastMo: 0,
    bufferReq: 11_892,
    stock: 6_644,
    prayagPlan: 5_248,
  },
];