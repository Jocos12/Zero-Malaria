# RBAC — 4 roles, permissions, scope

**Decision support tool. Not a replacement for clinical judgment.**  
Synthetic demo data only.

## Roles

| Code | Scope | Summary |
| --- | --- | --- |
| `SUPER_ADMIN` | national | Full access including permissions matrix; all users; config; audit. Only role that can create/edit/deactivate SUPER_ADMIN or RBC_ADMIN. |
| `RBC_ADMIN` | national | Manages HEALTH_CENTER and CHW; geography, facilities, stock, SLA; all dashboards, alerts, funnel, overdue referrals, audit; messages + reassign follow-ups. Cannot edit permissions matrix or SUPER_ADMIN accounts. |
| `HEALTH_CENTER` | facility | Referral inbox; status updates; messages; own-facility stock; read-only list of CHWs at own facility; confirm CHW **activity** counts at the facility (`activity:read|update`). |
| `CHW` | own / village | Own triages, referrals, follow-ups, voice triage; manual daily **activity** counts (`activity:create|read|update`). |

Legacy `SUPERVISOR` / `RBC_OFFICER` (and lowercase `supervisor` / `rbc`) are **migrated** on startup — never left as live roles. Mapping is audited (`role_migration_4roles`).

## Permission format

`resource:action` with actions `read | create | update | delete | export | assign` (+ `voice:use`).  
Default matrix: `apps/api/app/rbac_matrix.py`. SUPER_ADMIN = all codes; RBC_ADMIN = all except roles/permissions mutate.

| Permission | SUPER_ADMIN | RBC_ADMIN | HEALTH_CENTER | CHW |
| --- | --- | --- | --- | --- |
| `voice:use` | yes | yes | yes | yes |
| `activity:read` | yes | yes | yes | yes |
| `activity:create` | yes | no | no | yes |
| `activity:update` | yes | no | yes | yes |
| `activity:export` | yes | yes | no | no |

`voice:use` gates `/voice/transcribe`, `/voice/speak`, `/voice/capabilities`. Missing/invalid/expired token → **401** with `token_missing` / `token_invalid` / `token_expired`. Missing permission → **403** `missing_permission`. Unconfigured STT → **503** (never 401).

**Activity counts** (`/activity-counts`): CHW manual entry (scoped to own `chw_code`); auto rows are system-derived (`source=auto`). Summary returns `auto_total`, `manual_total`, and `combined` where **combined = auto + manual** (distinct sources, not deduplicated across both).

## Scope

| Role | Scope |
| --- | --- |
| SUPER_ADMIN / RBC_ADMIN | national |
| HEALTH_CENTER | facility |
| CHW | own |

Enforced in query helpers and SSE — never trust client role/scope.

## Anti-escalation

- Nobody grants a permission/role they do not hold.
- Only SUPER_ADMIN manages SUPER_ADMIN / RBC_ADMIN.
- RBC_ADMIN cannot edit SUPER_ADMIN.
- Nobody deactivates/deletes self.
- Last active SUPER_ADMIN cannot be deactivated, deleted, or demoted.
- SUPER_ADMIN matrix row is locked.

## Login

Role is never chosen in the UI. `/auth/login` returns role + permissions from the account record. Frontend stores server response only.

## Password prompt

| Field | Values |
| --- | --- |
| `password_prompt_status` | `pending` \| `changed` \| `dismissed` |
| `ZM_PASSWORD_CHANGE_POLICY` | `prompt` (default; dismissible modal) or `enforce` (must change; dismiss blocked; API limited until changed) |

- Admin create / password reset → `pending`.
- User changes password → `changed`.
- User dismisses via `POST /auth/password-prompt/dismiss` → `dismissed` (prompt policy only; remembered server-side forever).
- Demo/seed accounts start as `dismissed` (no interrupt).
- Frontend never redirects to `/app/change-password` after login; optional page stays in Settings / avatar menu.
- Non-demo deployments should consider `ZM_PASSWORD_CHANGE_POLICY=enforce`.
