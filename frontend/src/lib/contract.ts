// TypeScript shapes for contracts/trip_result.schema.json (v0.2.0).
// The schema is the source of truth; keep these in step with it.

export type Environment = "live" | "sandbox" | "fixture" | "unavailable";
export type OptionEnvironment = Exclude<Environment, "unavailable">;
export type RankingPriority = "lowest_total_cost" | "closest_pickup" | "most_flexible_cancellation";
export type Status = "recommended" | "alternative" | "not_a_fit";
export type UnavailableReason =
  | "timed_out"
  | "no_access"
  | "error"
  | "missing_fees"
  | "incomplete_data"
  | "not_set_up";

export interface TripRequest {
  start_area: string;
  airports: string[];
  end_area: string;
  pickup_datetime: string;
  return_datetime: string;
  days: number;
  travelers: number;
  drivers: { age: number }[];
  car_class: string;
  one_way_ok: boolean;
  max_travel_minutes_to_branch: number;
  ranking_priority: RankingPriority;
}

export interface Cancellation {
  type: "free" | "partial" | "non_refundable" | "unknown";
  free_until?: string | null;
  fee?: number | null;
  summary: string;
}

export interface MileagePolicy {
  type: "unlimited" | "capped";
  cap_miles?: number;
  per_mile_cost?: number;
}

export interface Option {
  option_id: string;
  brand: string;
  pickup_branch: string;
  dropoff_branch: string;
  pickup_time: string;
  dropoff_time: string;
  base_daily_rate: number;
  days: number;
  base_total: number;
  airport_concession_fee: number;
  taxes: number;
  other_fees: number;
  additional_driver_fee: number;
  young_renter_fee: number;
  one_way_fee: number;
  mileage_policy: MileagePolicy;
  travel_to_branch: { minutes: number; cost: number; note?: string };
  car_class: string;
  seats: number;
  luggage_fit_note: string;
  total_trip_cost: number;
  cancellation: Cancellation;
  source: { name: string; captured_at: string; environment: OptionEnvironment };
  rank?: number | null;
  status: Status;
  tags?: string[];
  reason?: string;
}

export interface ProviderCoverage {
  provider: string;
  result: "complete" | "partial" | "no_cars" | "unavailable";
  reason?: UnavailableReason | null;
  source: string | null;
  options_returned: number;
}

export interface SourceAttempt {
  source: string;
  outcome: "used" | "partial" | "unavailable" | "skipped";
  reason?: UnavailableReason | null;
  environment: Environment;
  attempted_at: string | null;
}

export type StepType =
  | "request"
  | "search"
  | "coverage"
  | "source_fallback"
  | "pricing"
  | "filter"
  | "ranking"
  | "confirmation"
  | "approval"
  | "handoff";

export interface AuditStep {
  step_number: number;
  step_name: string;
  plain_language_finding: string;
  timestamp: string;
  step_type?: StepType;
}

export interface WinnerSummary {
  recommended_option_id: string;
  ranking_priority_used: RankingPriority;
  total: number;
  obvious_option_id?: string;
  savings_vs_obvious_option: number;
  one_line_explanation: string;
}

export interface Confirmation {
  confirmation_summary: {
    what: string;
    where: string;
    dates: string;
    total: number;
    cancellation_policy: string;
    drivers: string[];
  };
  human_approved: boolean;
  approved_at: string | null;
  handoff_type: "rental_company_checkout" | "simulated_booking";
  handoff_url?: string | null;
}

export interface TripResult {
  schema_version: string;
  currency: string;
  money_unit: "cents";
  placeholder_notice?: string;
  data_source: { data_source: string; captured_at: string | null; environment: Environment };
  coverage: { source_attempts: SourceAttempt[]; providers: ProviderCoverage[] };
  trip_request: TripRequest;
  options: Option[];
  winner_summary: WinnerSummary | null;
  audit_trail: AuditStep[];
  confirmation: Confirmation | null;
}
