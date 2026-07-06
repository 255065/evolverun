"""Provider interface contracts.

Every wearable/activity provider must implement ProviderClient. The interface
is intentionally narrow — the goal is that swapping the implementation
(e.g. garth → official Garmin API later) requires only changing one file.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

Sport = Literal["running", "cycling", "swimming", "strength", "walking", "hiking", "other"]


class ProviderError(Exception):
    """Base class for provider errors. Subclass for specific auth / rate-limit cases."""


class ProviderAuthError(ProviderError):
    """Auth token invalid / expired / revoked. User must reconnect."""


class ProviderRateLimitError(ProviderError):
    """Provider rate-limited us. Retry later."""


@dataclass
class ProviderTokens:
    """Token bundle returned by OAuth completion. Encrypted before DB insert."""

    access_token: str
    refresh_token: str | None = None
    expires_at: datetime | None = None
    scope: str | None = None
    provider_user_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class OAuthFlowResult:
    """Result of starting an OAuth authorization flow."""

    authorize_url: str
    state: str  # opaque value the provider echoes back to the callback


@dataclass
class NormalizedActivity:
    """A workout/activity in EvolveRun's internal shape, ready for `workouts` table."""

    source: str  # provider slug
    source_id: str  # provider's id for this activity
    sport: Sport
    started_at: datetime
    duration_seconds: int
    distance_m: float | None = None
    elevation_gain_m: float | None = None
    avg_hr: int | None = None
    max_hr: int | None = None
    avg_pace_s_per_km: float | None = None
    avg_power_w: float | None = None
    normalized_power_w: float | None = None
    trimp: float | None = None
    tss: float | None = None
    perceived_effort: int | None = None
    notes: str | None = None
    # --- Deep fields (Tier 1/2 from Garmin) ---
    cadence_avg: int | None = None
    cadence_max: int | None = None
    temperature_c: float | None = None
    calories: int | None = None
    aerobic_te: float | None = None         # Garmin training effect 0–5
    anaerobic_te: float | None = None
    training_load: float | None = None      # Garmin's EPOC-based load
    hr_zone_seconds: dict[str, int] | None = None  # {"z1": 600, ..., "z5": 120}
    power_zone_seconds: dict[str, int] | None = None
    cardiac_drift_pct: float | None = None
    pace_decay_pct: float | None = None
    polarized_score: float | None = None
    weather_payload: dict[str, Any] | None = None
    vo2max_at_activity: float | None = None
    splits: list["NormalizedSplit"] = field(default_factory=list)
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedSplit:
    """One lap inside an activity — feeds `workout_splits` table."""

    split_index: int
    split_type: str | None = None
    duration_s: int | None = None
    distance_m: float | None = None
    avg_hr: int | None = None
    max_hr: int | None = None
    avg_pace_s_per_km: float | None = None
    avg_speed_mps: float | None = None
    avg_cadence: int | None = None
    avg_power_w: float | None = None
    elevation_gain_m: float | None = None
    intensity: str | None = None


@dataclass
class NormalizedDailyMetric:
    """A single day's wellness snapshot, ready for `daily_metrics` table."""

    metric_date: date
    resting_hr: int | None = None
    hrv_rmssd: float | None = None
    sleep_minutes: int | None = None
    sleep_score: int | None = None
    readiness_score: int | None = None
    body_battery: int | None = None
    weight_kg: float | None = None
    body_temp_delta: float | None = None
    # --- Deep recovery fields ---
    stress_avg: int | None = None
    stress_max: int | None = None
    steps: int | None = None
    floors_climbed: int | None = None
    intensity_minutes_moderate: int | None = None
    intensity_minutes_vigorous: int | None = None
    spo2_avg: int | None = None
    spo2_min: int | None = None
    respiration_avg: int | None = None
    respiration_min: int | None = None
    respiration_max: int | None = None
    body_fat_pct: float | None = None
    active_calories: int | None = None
    total_calories: int | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedPerformanceSnapshot:
    """Garmin's own performance estimates — feeds `performance_profiles`."""

    snapshot_date: date
    garmin_training_status: str | None = None
    garmin_training_load_focus: str | None = None
    garmin_endurance_score: int | None = None
    garmin_hill_score: int | None = None
    garmin_fitness_age: int | None = None
    garmin_running_tolerance: int | None = None
    garmin_vo2max: float | None = None
    garmin_lt_hr: int | None = None
    garmin_lt_pace_s_per_km: float | None = None
    race_prediction_5k_s: int | None = None
    race_prediction_10k_s: int | None = None
    race_prediction_hm_s: int | None = None
    race_prediction_marathon_s: int | None = None
    body_fat_pct: float | None = None
    muscle_mass_kg: float | None = None
    ftp_w: float | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedAthleteProfile:
    """Profile fields the provider can populate on the athlete's user row."""

    date_of_birth: date | None = None
    sex: str | None = None                  # 'male' / 'female' / 'other'
    height_cm: float | None = None
    weight_kg: float | None = None
    max_hr: int | None = None               # provider-reported or auto-detected
    resting_hr: int | None = None
    lactate_threshold_hr: int | None = None
    vo2max_running: float | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class NormalizedPersonalRecord:
    """A best-effort PR from a provider."""

    source: str
    record_type: str              # 'best_5k_s', 'longest_run_m', 'biggest_climb_m', ...
    value: float                  # seconds / meters / kg — unit lives in record_type
    unit: str | None = None
    achieved_at: datetime | None = None
    activity_source_id: str | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class CredentialLoginResult:
    """Result of a credential (username/password) login attempt.

    Garmin and similar non-OAuth providers report MFA in two stages: the first
    `login_with_credentials` call may return `needs_mfa=True` with a `pending_state`
    that the caller stores, then `complete_credential_login(pending_state, mfa_code)`
    finishes the flow.
    """

    tokens: ProviderTokens | None = None  # None if MFA still required
    needs_mfa: bool = False
    pending_state: str | None = None  # serialized so the next call can resume


class ProviderClient(ABC):
    """Protocol every provider implements.

    Implementations should be cheap to construct — connection pooling, token
    refresh, etc. live inside the methods, not the constructor.

    Auth model varies: OAuth providers (Strava) implement start_oauth +
    complete_oauth. Credential-based providers (Garmin via garminconnect)
    implement login_with_credentials + optionally complete_credential_login.
    Unsupported methods raise NotImplementedError by default.
    """

    slug: str  # short id used in URLs and the oauth_connections.provider column

    # -- OAuth -------------------------------------------------------------
    def start_oauth(
        self, *, user_id: str, redirect_uri: str, next_path: str | None = None
    ) -> OAuthFlowResult:
        """Begin OAuth. Returns the URL we should redirect the user to.

        `next_path` is an in-app path to return the user to after the callback.
        """
        raise NotImplementedError(f"{self.slug} does not support OAuth")

    async def complete_oauth(
        self, *, code: str, state: str, redirect_uri: str
    ) -> ProviderTokens:
        """Exchange the OAuth code for tokens."""
        raise NotImplementedError(f"{self.slug} does not support OAuth")

    # -- Credential login (non-OAuth providers) ----------------------------
    async def login_with_credentials(
        self, *, user_id: str, username: str, password: str
    ) -> CredentialLoginResult:
        """Authenticate with username/password. May return `needs_mfa=True`."""
        raise NotImplementedError(f"{self.slug} does not support credential login")

    async def complete_credential_login(
        self, *, user_id: str, pending_state: str, mfa_code: str, username: str, password: str
    ) -> ProviderTokens:
        """Finish a 2FA-gated credential login by supplying the user's MFA code."""
        raise NotImplementedError(f"{self.slug} does not support MFA completion")

    # -- Token refresh -----------------------------------------------------
    @abstractmethod
    async def refresh(self, tokens: ProviderTokens) -> ProviderTokens:
        """Refresh an expired access token. May return the same bundle if no refresh needed."""
        raise NotImplementedError

    # -- Data fetch --------------------------------------------------------
    @abstractmethod
    async def fetch_activities(
        self,
        tokens: ProviderTokens,
        *,
        since: datetime,
        until: datetime | None = None,
    ) -> list[NormalizedActivity]:
        """Pull activities in the given time window."""
        raise NotImplementedError

    @abstractmethod
    async def fetch_daily_metrics(
        self,
        tokens: ProviderTokens,
        *,
        since: date,
        until: date | None = None,
    ) -> list[NormalizedDailyMetric]:
        """Pull daily wellness metrics. Implementations that don't have wellness data
        (e.g. Strava) should return []."""
        raise NotImplementedError

    # -- Optional deeper fetches (only Garmin implements all of these) -----
    async def fetch_activity_details(
        self,
        tokens: ProviderTokens,
        *,
        source_id: str,
    ) -> NormalizedActivity | None:
        """Hydrate one activity with splits, HR/power zones, weather. Optional."""
        return None

    async def fetch_performance_snapshot(
        self,
        tokens: ProviderTokens,
        *,
        for_date: date | None = None,
    ) -> NormalizedPerformanceSnapshot | None:
        """Provider's own performance estimates (VO2max, LT, race predictions, training status)."""
        return None

    async def fetch_personal_records(
        self,
        tokens: ProviderTokens,
    ) -> list[NormalizedPersonalRecord]:
        """Best efforts (5k PR, longest run, biggest climb, etc.)."""
        return []

    async def fetch_athlete_profile(
        self,
        tokens: ProviderTokens,
    ) -> NormalizedAthleteProfile | None:
        """Provider-reported athlete profile (DOB, sex, weight, max HR, etc.).
        Optional — providers without profile access return None.
        """
        return None

    async def detect_history_start(
        self,
        tokens: ProviderTokens,
    ) -> datetime | None:
        """Return the earliest activity date the provider has on file.

        Used by sync orchestrators to size an all-time backfill window
        instead of guessing a fixed days_back. Optional; providers that
        can't introspect their own history return None and the caller
        falls back to a sensible default (e.g. 2 years).
        """
        return None

    # -- Webhooks ----------------------------------------------------------
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        """Verify a webhook signature. Override per provider. Default rejects all."""
        return False
