from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class TriageRequest(BaseModel):
    age_months: int = Field(ge=0, le=1200)
    sex: Literal["female", "male"] = "female"
    temperature_c: float = Field(ge=30, le=45)
    fever_days: int = Field(ge=0, le=30)
    convulsions: bool = False
    unable_to_drink: bool = False
    vomiting_everything: bool = False
    lethargy: bool = False
    severe_breathing_difficulty: bool = False
    pale_palms_or_eyelids: Optional[Literal["yes", "no", "unknown"]] = None
    blood_in_stool: Optional[Literal["yes", "no", "unknown"]] = None
    dark_or_bloody_urine: Optional[Literal["yes", "no", "unknown"]] = None
    bleeding_nose_gums_skin_or_vomit_blood: Optional[Literal["yes", "no", "unknown"]] = None
    hemoglobin_g_dl: Optional[float] = Field(default=None, ge=0, le=25)
    tdr_result: Literal["positive", "negative", "invalid"] = "positive"
    language: str = "rw"
    use_ml: bool = True
    free_text: Optional[str] = None
    # Architecture demo only: "ml_escalate" injects synthetic ML score >= 0.35
    demo_scenario: Optional[str] = None
    include_ai_trace: bool = True


class TriageResponse(BaseModel):
    decision: str
    rules_decision: str
    reasons: list[str]
    triggered_rules: list[str]
    ml_escalated: bool
    severe_risk: Optional[float] = None
    referral_noncompletion_risk: Optional[float] = None
    shap_factors: list[str] = []
    confidence: Optional[float] = None
    human_confirmation_required: bool = True
    disclaimer: str
    synthetic_note: str
    extracted_from_text: Optional[dict[str, Any]] = None
    public_decision: Optional[str] = None
    ml_threshold_treat_to_refer: Optional[float] = 0.35
    reason_details: list[dict[str, Any]] = []
    missing_info: list[str] = []
    protocol_reference: Optional[str] = None
    inform_nurse_fields: list[str] = []
    pending_blood_clinical_validation: bool = False
    ai_trace: Optional[dict[str, Any]] = None


class ReferralCreate(BaseModel):
    client_uuid: str
    facility_id: str
    chw_id: str = "CHW-DEMO-01"
    district: str
    sector: str = ""
    age_months: int
    sex: str = "female"
    decision: Literal["refer", "urgent_refer"]
    reasons: list[str] = []
    summary: str = ""
    case_id: Optional[str] = None
    convulsions: bool = False
    unable_to_drink: bool = False
    vomiting_everything: bool = False
    lethargy: bool = False
    severe_breathing_difficulty: bool = False
    temperature_c: Optional[float] = None
    fever_days: Optional[int] = None
    tdr_result: Optional[str] = None


class ReferralOut(BaseModel):
    id: str
    client_uuid: str
    facility_id: str
    chw_id: str
    district: str
    sector: str
    age_months: int
    sex: str
    decision: str
    reasons: list[str]
    summary: str
    status: str
    created_at: datetime
    received_at: Optional[datetime] = None
    arrived_at: Optional[datetime] = None
    treated_at: Optional[datetime] = None
    demo_flag: bool = False
    overdue: bool = False


class StatusUpdate(BaseModel):
    status: Literal["received", "arrived", "treated"]


class SyncItem(BaseModel):
    client_uuid: str
    type: Literal["referral", "triage", "activity_count"]
    payload: dict[str, Any]


class SyncRequest(BaseModel):
    items: list[SyncItem]


class SyncResponse(BaseModel):
    accepted: int
    duplicates: int
    results: list[dict[str, Any]]


class ExtractRequest(BaseModel):
    text: str
    language: str = "en"


class HealthOut(BaseModel):
    status: str
    synthetic: bool = True
    disclaimer: str
    demo_today: str


class ReferralMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ReferralMessageOut(BaseModel):
    id: str
    referral_id: str
    sender_id: Optional[str] = None
    sender_role: str
    body: str
    created_at: datetime
    read_at: Optional[datetime] = None


class ActivityCountMetrics(BaseModel):
    patients_seen: int = Field(ge=0, le=500)
    patients_treated: int = Field(ge=0, le=500)
    rdt_done: int = Field(ge=0, le=500)
    rdt_positive: int = Field(ge=0, le=500)
    referred: int = Field(ge=0, le=500)


class ActivityCountCreate(ActivityCountMetrics):
    client_uuid: str
    date: str = Field(description="ISO date YYYY-MM-DD")
    note: Optional[str] = Field(default=None, max_length=2000)
    version: Optional[int] = Field(default=None, description="Required when updating via client_uuid")


class ActivityCountOut(ActivityCountMetrics):
    id: str
    client_uuid: str
    chw_id: str
    facility_id: str
    date: str
    source: Literal["auto", "manual"]
    note: Optional[str] = None
    version: int
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[datetime] = None


class ActivityCountSummaryOut(BaseModel):
    synthetic: bool = True
    date_from: str
    date_to: str
    auto_total: ActivityCountMetrics
    manual_total: ActivityCountMetrics
    combined: ActivityCountMetrics
    note: str = (
        "combined sums auto_total + manual_total by metric. "
        "Auto and manual are distinct sources for the same day — never merged into one row."
    )
