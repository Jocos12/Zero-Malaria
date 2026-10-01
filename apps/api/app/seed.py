#!/usr/bin/env python3
"""Seed SQLite from synthetic CSVs + deterministic demo scenario referrals."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.auth import hash_password
from app.config import REPO_ROOT, settings
from app.db import (
    Base,
    CaseRecord,
    Facility,
    Referral,
    ReferralMessage,
    SessionLocal,
    StockRecord,
    User,
    init_db,
)

DATA = REPO_ROOT / "data"

PROMINENT_PILOT_DISTRICTS = ("Gisagara", "Nyamagabe", "Nyagatare", "Nyamasheke")

EXTRA_FACILITIES = [
    {
        "facility_id": "HC-NYM-01",
        "name": "Nyamagabe Health Center",
        "district": "Nyamagabe",
        "sector": "Nyamagabe",
        "pilot": 1,
        "remote": 0,
        "latitude": -2.48,
        "longitude": 29.55,
    },
    {
        "facility_id": "HC-NYM-02",
        "name": "Kibirizi Health Center",
        "district": "Nyamagabe",
        "sector": "Kibirizi",
        "pilot": 1,
        "remote": 1,
        "latitude": -2.52,
        "longitude": 29.48,
    },
    {
        "facility_id": "HC-NYM-03",
        "name": "Gasaka Health Center",
        "district": "Nyamagabe",
        "sector": "Gasaka",
        "pilot": 1,
        "remote": 0,
        "latitude": -2.45,
        "longitude": 29.58,
    },
    {
        "facility_id": "HC-NMS-01",
        "name": "Macuba Health Center",
        "district": "Nyamasheke",
        "sector": "Bushekeri",
        "pilot": 1,
        "remote": 1,
        "latitude": -2.38,
        "longitude": 29.12,
    },
    {
        "facility_id": "HC-NMS-02",
        "name": "Kanjongo Health Center",
        "district": "Nyamasheke",
        "sector": "Kanjongo",
        "pilot": 1,
        "remote": 0,
        "latitude": -2.42,
        "longitude": 29.08,
    },
]

OVERDUE_SECTORS = (("Gisagara", "Save"), ("Nyamagabe", "Kibirizi"))

# Login accounts for the live demo. Password is always ZM_DEMO_PASSWORD.
DEMO_ACCOUNTS = [
    {
        "id": "user-chw-demo",
        "username": "chw.demo",
        "display_name": "CHW Demo (Nyamata)",
        "role": "CHW",
        "district": "Bugesera",
        "facility_id": "HC-BUG-01",
        "village": "Nyamata",
        "chw_code": "CHW-BUG-01-01",
        "phone": "+250780000001",
    },
    {
        "id": "user-chw-gisagara",
        "username": "chw.gisagara",
        "display_name": "CHW Demo (Gisagara)",
        "role": "CHW",
        "district": "Gisagara",
        "facility_id": "HC-GIS-01",
        "village": "Gisagara",
        "chw_code": "CHW-GIS-01-01",
        "phone": "+250780000010",
    },
    {
        "id": "user-hc-demo",
        "username": "health.center",
        "display_name": "Health Center Demo (Nyamata HC)",
        "role": "HEALTH_CENTER",
        "district": "Bugesera",
        "facility_id": "HC-BUG-01",
        "village": "",
        "chw_code": "",
        "phone": "+250780000002",
    },
    {
        "id": "user-super-admin",
        "username": "super.admin",
        "display_name": "Super Admin Demo",
        "role": "SUPER_ADMIN",
        "district": "",
        "facility_id": "",
        "village": "",
        "chw_code": "",
        "phone": "+250780000099",
    },
    {
        "id": "user-rbc-admin",
        "username": "rbc.admin",
        "display_name": "RBC Admin Demo",
        "role": "RBC_ADMIN",
        "district": "",
        "facility_id": "",
        "village": "",
        "chw_code": "",
        "phone": "+250780000098",
    },
]


def resolve_seed_mode(cli_mode: str | None) -> str:
    mode = (cli_mode or os.environ.get("ZM_SEED_MODE") or "full").lower()
    if mode not in ("full", "demo"):
        raise SystemExit(f"Invalid seed mode {mode!r}; use full or demo")
    return mode


def load_csvs(db) -> None:
    facilities = pd.read_csv(DATA / "facilities.csv")
    for _, row in facilities.iterrows():
        db.merge(
            Facility(
                facility_id=row["facility_id"],
                name=row["name"],
                district=row["district"],
                sector=row["sector"],
                pilot=int(row["pilot"]),
                remote=int(row["remote"]),
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
            )
        )

    cases = pd.read_csv(DATA / "cases_synthetic.csv")
    # Need 3000+ rows; CSV density requires a wider window than 16 calendar weeks.
    cases = cases[cases["date"] >= "2025-10-01"].sort_values("date")
    for _, row in cases.iterrows():
        delay = row["arrival_delay_hours"]
        db.merge(
            CaseRecord(
                case_id=row["case_id"],
                date=row["date"],
                district=row["district"],
                sector=row["sector"],
                chw_id=row["chw_id"],
                age_months=int(row["age_months"]),
                sex=row["sex"],
                temperature_c=float(row["temperature_c"]),
                fever_days=int(row["fever_days"]),
                convulsions=int(row["convulsions"]),
                unable_to_drink=int(row["unable_to_drink"]),
                vomiting_everything=int(row["vomiting_everything"]),
                lethargy=int(row["lethargy"]),
                severe_breathing_difficulty=int(row["severe_breathing_difficulty"]),
                tdr_result=row["tdr_result"],
                decision=row["decision"],
                referral_completed=int(row["referral_completed"]),
                arrival_delay_hours=None if pd.isna(delay) else float(delay),
                outcome=row["outcome"],
            )
        )

    stock = pd.read_csv(DATA / "stock_synthetic.csv")
    stock = stock[stock["week_start"] >= "2025-10-01"]
    for _, row in stock.iterrows():
        db.add(
            StockRecord(
                facility_id=row["facility_id"],
                facility_name=row["facility_name"],
                district=row["district"],
                week_start=row["week_start"],
                commodity=row["commodity"],
                unit=row["unit"],
                stock_on_hand=int(row["stock_on_hand"]),
                quantity_consumed=int(row["quantity_consumed"]),
                stockout=int(row["stockout"]),
                weeks_of_cover=float(row["weeks_of_cover"]),
            )
        )


def ensure_prominent_pilot_districts(db) -> None:
    """Gisagara/Nyamagabe (and Nyamasheke, Nyagatare) visible as pilot districts."""
    db.flush()
    for spec in EXTRA_FACILITIES:
        db.merge(Facility(**spec))

    db.flush()
    for fac in db.query(Facility).all():
        if fac.district in PROMINENT_PILOT_DISTRICTS:
            fac.pilot = 1


def seed_users(db) -> None:
    """Deterministic demo accounts: 1 SUPER_ADMIN, 1 RBC_ADMIN, HC per facility, many CHW."""
    users = [dict(account) for account in DEMO_ACCOUNTS]
    facilities = db.query(Facility).all()
    rng = random.Random(20260930)
    # One HEALTH_CENTER per facility (skip Nyamata — already have health.center)
    for i, fac in enumerate(facilities):
        if fac.facility_id == "HC-BUG-01":
            continue
        users.append(
            {
                "id": f"user-hc-{i:02d}",
                "username": f"hc.{fac.facility_id.lower().replace('-', '.')}",
                "display_name": f"HC Staff {fac.name}",
                "role": "HEALTH_CENTER",
                "district": fac.district,
                "facility_id": fac.facility_id,
                "village": "",
                "chw_code": "",
                "phone": f"+25079{100000 + i:06d}",
            }
        )
    # Extra CHWs (~40 total including demos)
    chw_needed = max(0, 40 - 2)
    for i in range(chw_needed):
        fac = facilities[i % len(facilities)] if facilities else None
        if not fac:
            break
        code = _chw_for_facility(fac.facility_id, (i % 4) + 1)
        users.append(
            {
                "id": f"user-chw-{i:03d}",
                "username": f"chw.synth.{i:03d}",
                "display_name": f"CHW {fac.sector} #{i + 1}",
                "role": "CHW",
                "district": fac.district,
                "facility_id": fac.facility_id,
                "village": fac.sector,
                "chw_code": code,
                "phone": f"+25078{100000 + i:06d}",
            }
        )

    pw = hash_password(settings.demo_password)
    for u in users:
        if db.query(User).filter(User.username == u["username"]).first():
            continue
        # Demo/synth accounts never interrupt demos with a password prompt.
        db.add(
            User(
                password_hash=pw,
                active=True,
                must_change_password=False,
                password_prompt_status="dismissed",
                **u,
            )
        )
    _ = rng


def ensure_demo_users(db) -> int:
    """Create the demo login accounts if the database is empty. Does not delete existing rows."""
    from app.auth import verify_password

    password_hash = hash_password(settings.demo_password)
    created = 0
    for account in DEMO_ACCOUNTS:
        row = db.query(User).filter(User.username == account["username"]).first()
        if row is None:
            db.add(
                User(
                    password_hash=password_hash,
                    active=True,
                    must_change_password=False,
                    password_prompt_status="dismissed",
                    **account,
                )
            )
            created += 1
            continue
        row.active = True
        row.deleted_at = None
        row.failed_login_count = 0
        row.locked_until = None
        row.must_change_password = False
        row.password_prompt_status = "dismissed"
        if not verify_password(settings.demo_password, row.password_hash):
            row.password_hash = password_hash
    return created


def _chw_for_facility(facility_id: str, idx: int) -> str:
    prefix = facility_id.replace("HC-", "CHW-")
    return f"{prefix}-{idx:02d}"


def seed_rich_demo(db) -> None:
    """Synthetic referrals across facilities with consistent lifecycle timestamps."""
    if db.query(Referral).filter(Referral.client_uuid.like("rich-%")).first():
        return

    today = datetime.fromisoformat(settings.demo_today)
    rng = random.Random(20260930)
    facilities = db.query(Facility).all()
    if not facilities:
        return

    decisions = [
        ("urgent_refer", ["Convulsions (fits) reported"], "URGENT referral"),
        ("urgent_refer", ["Unable to drink or feed"], "URGENT referral"),
        ("refer", ["Invalid TDR — refer for repeat testing"], "Referral"),
        ("refer", ["Persistent fever with negative TDR"], "Referral"),
    ]
    statuses_weights = [
        ("sent", 0.22),
        ("received", 0.28),
        ("arrived", 0.28),
        ("treated", 0.22),
    ]

    n_target = 60  # fixed for deterministic seed
    created: list[Referral] = []
    rw_threads = [
        ("Tegura ubwikorezi", "Byakiriwe. Mutegeka umuryango."),
        ("Dukeneye andi makuru", "Twohereje amakuru y'inyongera."),
        ("Umuryango urimo kuza", "Turabategereje ku kigo."),
    ]

    for i in range(n_target):
        fac = rng.choice(facilities)
        decision, reasons, label = rng.choice(decisions)
        status = rng.choices([s for s, _ in statuses_weights], weights=[w for _, w in statuses_weights])[0]
        age = rng.randint(4, 59)
        sex = rng.choice(["female", "male"])
        hours_ago = rng.randint(2, 18 * 24)
        created_at = today - timedelta(hours=hours_ago)
        received_at = arrived_at = treated_at = None

        if status in ("received", "arrived", "treated"):
            received_at = created_at + timedelta(hours=rng.randint(1, 8))
        if status in ("arrived", "treated"):
            arrived_at = received_at + timedelta(hours=rng.randint(1, 12)) if received_at else None
        if status == "treated":
            treated_at = arrived_at + timedelta(hours=rng.randint(1, 24)) if arrived_at else None

        demo_flag = rng.random() < 0.08
        client_uuid = f"rich-{i:04d}"
        created.append(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, client_uuid)),
                client_uuid=client_uuid,
                case_id=f"RICH-{i:05d}",
                facility_id=fac.facility_id,
                chw_id=_chw_for_facility(fac.facility_id, rng.randint(1, 4)),
                district=fac.district,
                sector=fac.sector,
                age_months=age,
                sex=sex,
                decision=decision,
                reasons_json=json.dumps(reasons),
                summary=f"{label}: {sex}, {age} months, {fac.district}/{fac.sector}.",
                status=status,
                created_at=created_at,
                received_at=received_at,
                arrived_at=arrived_at,
                treated_at=treated_at,
                demo_flag=demo_flag,
            )
        )

    # Overdue urgent never-arrived in two sectors
    for idx, (district, sector) in enumerate(OVERDUE_SECTORS):
        fac = (
            db.query(Facility)
            .filter(Facility.district == district, Facility.sector == sector)
            .first()
        )
        if not fac:
            continue
        client_uuid = f"rich-overdue-{idx}"
        created.append(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, client_uuid)),
                client_uuid=client_uuid,
                case_id=f"RICH-OVER-{idx}",
                facility_id=fac.facility_id,
                chw_id=_chw_for_facility(fac.facility_id, 1),
                district=district,
                sector=sector,
                age_months=rng.randint(8, 36),
                sex=rng.choice(["female", "male"]),
                decision="urgent_refer",
                reasons_json=json.dumps(["Unable to drink or feed"]),
                summary=f"URGENT overdue: never arrived ({district}/{sector}).",
                status="sent",
                created_at=today - timedelta(hours=settings.overdue_hours + rng.randint(6, 48)),
                demo_flag=True,
            )
        )

    db.add_all(created)
    db.flush()

    # Kinyarwanda coordination threads (synthetic) for a subset of referrals
    for i, row in enumerate(created[:40]):
        chip_a, chip_b = rw_threads[i % len(rw_threads)]
        base_t = row.received_at or row.created_at
        msgs = [
            ReferralMessage(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{row.client_uuid}-m1")),
                referral_id=row.id,
                sender_id=None,
                sender_role="HEALTH_CENTER",
                body=chip_a,
                created_at=base_t + timedelta(minutes=5),
            ),
            ReferralMessage(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{row.client_uuid}-m2")),
                referral_id=row.id,
                sender_id=None,
                sender_role="CHW",
                body=chip_b,
                created_at=base_t + timedelta(minutes=20),
                read_at=base_t + timedelta(minutes=25),
            ),
        ]
        db.add_all(msgs)


def seed_demo_script_cases(db) -> None:
    """Deterministic demo referrals for live demo UUIDs (Phase 8 script)."""
    today = datetime.fromisoformat(settings.demo_today)
    facility_id = "HC-BUG-01"
    urgent_uuid = "demo-urgent-case-b"
    existing = db.query(Referral).filter(Referral.client_uuid == urgent_uuid).first()
    if not existing:
        db.add(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, urgent_uuid)),
                client_uuid=urgent_uuid,
                case_id="DEMO-CASE-B",
                facility_id=facility_id,
                chw_id="CHW-BUG-01-01",
                district="Bugesera",
                sector="Nyamata",
                age_months=28,
                sex="male",
                decision="urgent_refer",
                reasons_json=json.dumps(["Convulsions (fits) reported"]),
                summary="URGENT: Male, 28 months, TDR+, convulsions. Digital handover from CHW.",
                status="sent",
                created_at=today - timedelta(hours=2),
                demo_flag=True,
            )
        )

    overdue_uuid = "demo-overdue-never-arrived"
    existing2 = db.query(Referral).filter(Referral.client_uuid == overdue_uuid).first()
    if not existing2:
        db.add(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, overdue_uuid)),
                client_uuid=overdue_uuid,
                case_id="DEMO-CASE-MISS",
                facility_id=facility_id,
                chw_id="CHW-BUG-01-01",
                district="Bugesera",
                sector="Nyamata",
                age_months=18,
                sex="female",
                decision="urgent_refer",
                reasons_json=json.dumps(["Unable to drink or feed"]),
                summary="URGENT: Female, 18 months, unable to drink. Follow up — not arrived.",
                status="sent",
                created_at=today - timedelta(hours=36),
                demo_flag=True,
            )
        )

    routine_uuid = "demo-routine-received"
    if not db.query(Referral).filter(Referral.client_uuid == routine_uuid).first():
        db.add(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, routine_uuid)),
                client_uuid=routine_uuid,
                case_id="DEMO-CASE-R",
                facility_id=facility_id,
                chw_id="CHW-BUG-01-02",
                district="Bugesera",
                sector="Nyamata",
                age_months=40,
                sex="female",
                decision="refer",
                reasons_json=json.dumps(["Invalid TDR — refer for repeat testing / assessment"]),
                summary="Referral: Female, 40 months, invalid TDR.",
                status="received",
                created_at=today - timedelta(hours=8),
                received_at=today - timedelta(hours=6),
                demo_flag=True,
            )
        )

    # Gisagara-visible demo handover (received, on prominent pilot district)
    gis_uuid = "demo-gisagara-routine"
    if not db.query(Referral).filter(Referral.client_uuid == gis_uuid).first():
        db.add(
            Referral(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, gis_uuid)),
                client_uuid=gis_uuid,
                case_id="DEMO-CASE-GIS",
                facility_id="HC-GIS-01",
                chw_id="CHW-GIS-01-01",
                district="Gisagara",
                sector="Gisagara",
                age_months=22,
                sex="female",
                decision="refer",
                reasons_json=json.dumps(["Persistent fever with negative TDR"]),
                summary="Referral: Gisagara pilot — fever workup.",
                status="received",
                created_at=today - timedelta(hours=14),
                received_at=today - timedelta(hours=10),
                demo_flag=True,
            )
        )


def run_seed(db, mode: str) -> None:
    load_csvs(db)
    ensure_prominent_pilot_districts(db)
    seed_users(db)
    if mode == "full":
        seed_rich_demo(db)
    seed_demo_script_cases(db)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ZeroMalaria SQLite database")
    parser.add_argument(
        "--mode",
        choices=("full", "demo"),
        default=None,
        help="full=CSVs+rich referrals+demo cases; demo=CSVs+demo cases only (or set ZM_SEED_MODE)",
    )
    args = parser.parse_args()
    mode = resolve_seed_mode(args.mode)

    db_path = Path(settings.database_url.replace("sqlite:///", ""))
    if db_path.exists():
        try:
            db_path.unlink()
        except PermissionError:
            init_db()
            db = SessionLocal()
            try:
                for table in reversed(Base.metadata.sorted_tables):
                    db.execute(table.delete())
                db.commit()
            finally:
                db.close()
    init_db()
    db = SessionLocal()
    try:
        print("Loading synthetic CSVs into SQLite...")
        print(
            "Synthetic demo data — source districts Gisagara/Nyamagabe per RBC problem canvas (to be verified)"
        )
        run_seed(db, mode)
        db.commit()
        n_cases = db.query(CaseRecord).count()
        n_ref = db.query(Referral).count()
        n_stock = db.query(StockRecord).count()
        n_users = db.query(User).count()
        n_pilot = db.query(Facility).filter(Facility.pilot == 1).count()
        print(f"Seed mode={mode} cases={n_cases} referrals={n_ref} stock_rows={n_stock} users={n_users} pilot_facilities={n_pilot}")
        print("=== Demo only accounts (password = ZM_DEMO_PASSWORD) ===")
        print(f"{'username':20} {'role':16} password")
        print(f"{'-'*20} {'-'*16} {'-'*12}")
        for u, r in (
            ("chw.demo", "CHW"),
            ("health.center", "HEALTH_CENTER"),
            ("rbc.admin", "RBC_ADMIN"),
            ("super.admin", "SUPER_ADMIN"),
        ):
            print(f"{u:20} {r:16} {settings.demo_password}")
        print("======================================================")
        print(f"DB: {db_path}")
        print("SYNTHETIC DEMO DATA - not for clinical use")
    finally:
        db.close()


if __name__ == "__main__":
    main()
