// Single env-flag rollback for the pricing v2 surface.
//
// Default: enabled. Set PRICING_V2=false in the deployment env to disable the
// new surface area in one shot:
//   - /pricing hides the LinkedIn add-on toggle, the Free banner, the
//     standalone LinkedIn card.
//   - /free-review              → 404
//   - /api/score-free           → 404
//   - /dashboard/linkedin       → 404
//   - /api/linkedin-rewrite     → 404
//
// The flag does NOT roll back the database SKU rename (starter→single,
// placement_pro→career). Restoring those requires a separate down-migration.
export function isPricingV2Enabled(): boolean {
  return process.env.PRICING_V2 !== "false";
}
