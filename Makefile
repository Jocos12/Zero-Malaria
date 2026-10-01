.PHONY: data train seed api web test install demo dev

demo:
	@echo "Run scripts/demo.ps1 on Windows, or: make seed && make api & make web"

ifeq ($(OS),Windows_NT)
VENV_BIN=.venv/Scripts
PYTHON=$(VENV_BIN)/python.exe
PY_BOOT=python
else
VENV_BIN=.venv/bin
PYTHON=$(VENV_BIN)/python
PY_BOOT=python3
endif
PY=$(PYTHON)

install:
	$(PY_BOOT) -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r apps/api/requirements.txt -r ml/requirements.txt
	cd apps/web && npm ci

data:
	$(PYTHON) data/generate_synthetic.py

train:
	$(PYTHON) ml/train.py

seed:
	$(PYTHON) apps/api/app/seed.py

seed-demo:
	$(PYTHON) apps/api/app/seed.py --mode demo

api:
	cd apps/api && ../../$(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Local full stack: API with --reload (clear error if venv/uvicorn missing) + Vite web
# Windows: powershell -File scripts/dev.ps1
dev:
	@echo "==> ZeroMalaria dev"
	@test -f "$(PYTHON)" || (echo "ERROR: missing $(PYTHON). Run: make install" && exit 1)
	@echo "==> API  http://127.0.0.1:8000  (uvicorn --reload)"
	@echo "==> WEB  http://127.0.0.1:5173"
	@echo "Tip (Windows): powershell -File scripts/dev.ps1"
	cd apps/api && ../.venv/Scripts/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

web:
	cd apps/web && npm run dev

test:
	$(PYTHON) -m pytest apps/api/tests -q
	cd apps/web && npm test -- --run
