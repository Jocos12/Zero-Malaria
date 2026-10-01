.PHONY: data train seed api web test install demo dev

demo:
	@echo "Run scripts/demo.ps1 on Windows, or: make seed && make api & make web"

VENV=.venv/Scripts
PY=$(VENV)/python

install:
	python -m venv .venv
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r apps/api/requirements.txt -r ml/requirements.txt
	cd apps/web && npm install

data:
	$(PY) data/generate_synthetic.py

train:
	$(PY) ml/train.py

seed:
	$(PY) apps/api/app/seed.py

seed-demo:
	$(PY) apps/api/app/seed.py --mode demo

api:
	cd apps/api && ../.venv/Scripts/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Local full stack: API with --reload (clear error if venv/uvicorn missing) + Vite web
# Windows: powershell -File scripts/dev.ps1
dev:
	@echo "==> ZeroMalaria dev"
	@test -f "$(PY)" -o -f "$(PY).exe" || (echo "ERROR: missing $(PY). Run: make install" && exit 1)
	@echo "==> API  http://127.0.0.1:8000  (uvicorn --reload)"
	@echo "==> WEB  http://127.0.0.1:5173"
	@echo "Tip (Windows): powershell -File scripts/dev.ps1"
	cd apps/api && ../.venv/Scripts/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

web:
	cd apps/web && npm run dev

test:
	$(PY) -m pytest apps/api/tests -q
	cd apps/web && npm test -- --run
