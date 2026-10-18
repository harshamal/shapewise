import type { Query } from "@/lib/screens";
import type { Workspace } from "@/lib/workspace";
import { CustomerStatements, FinancialStatements, GeneralLedger, TrialBalance } from "./accounting";
import { BankRulesScreen, BookClose } from "./money";
import { Capacity, ProductionFloor, QualityControl, Traceability } from "./production";
import { ReorderSuggestions, StockOnHand, ThreeWayMatch } from "./stock";

/** Purpose-built screens by submodule key: the ones that aren't a list of records or a report. */
const SCREENS: Record<string, (p: { ws: Workspace; q: Query; here: string }) => Promise<React.ReactNode>> = {
  general_ledger: GeneralLedger,
  trial_balance: TrialBalance,
  financial_statements: FinancialStatements,
  statements: CustomerStatements,
  stock: StockOnHand,
  reorder: ReorderSuggestions,
  three_way_match: ThreeWayMatch,
  production_overview: ProductionFloor,
  production_qc: QualityControl,
  capacity: Capacity,
  traceability: Traceability,
  bank_rules: BankRulesScreen,
  book_close: BookClose,
};

export const hasScreen = (submodule: string) => submodule in SCREENS;

export function Screen({ submodule, ...p }: { submodule: string; ws: Workspace; q: Query; here: string }) {
  const S = SCREENS[submodule]!;
  return <S {...p} />;
}
