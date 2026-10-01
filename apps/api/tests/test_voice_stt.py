"""Voice STT sanitizer + mock provider chain."""

from app.services.ai.voice_stt import sanitize_transcript, speak_plan, transcribe_audio, voice_capabilities


def test_sanitize_strips_phone_and_id():
    raw = "Call +250788123456 NID: AB1199887766554433 please"
    out = sanitize_transcript(raw)
    assert "250788123456" not in out
    assert "AB1199887766554433" not in out
    assert "[phone]" in out
    assert "[id]" in out


def test_transcribe_mock_returns_rw_text():
    # Non-empty blob triggers mock phrase
    out = transcribe_audio(b"x" * 64, language="rw")
    assert out["ok"] is True
    assert out["text"]
    assert out["provider"] == "mock"
    assert "AI-generated" not in out["text"]


def test_transcribe_empty_audio_fails_honestly():
    out = transcribe_audio(b"", language="rw")
    assert out["ok"] is False
    assert out["text"] == ""


def test_capabilities_report():
    caps = voice_capabilities("rw")
    assert caps["ok"] is True
    assert "stt_rw" in caps
    assert "tts_rw" in caps


def test_speak_plan_rw_text_only_without_phrase(monkeypatch):
    monkeypatch.delenv("PINDO_API_TOKEN", raising=False)
    monkeypatch.delenv("ZM_PINDO_API_TOKEN", raising=False)
    monkeypatch.setenv("PINDO_ACCESS_MODE", "authenticated")
    plan = speak_plan("Sobanura umuryango", phrase_id=None, language="rw")
    assert plan["mode"] == "text_only"
    assert plan["audio_url"] is None


def test_speak_plan_rw_uses_pindo_when_token(monkeypatch):
    monkeypatch.setenv("PINDO_API_TOKEN", "test-token")
    monkeypatch.setenv("PINDO_ACCESS_MODE", "authenticated")

    def fake_synth(text, cache_key=None, speech_rate=1.0, timeout=12.0):
        return {"ok": True, "audio_url": "https://cdn.example/pindo.mp3", "mode": "pindo_tts"}

    monkeypatch.setattr("app.services.ai.pindo_tts.synthesize_rw", fake_synth)
    plan = speak_plan("Imyaka mu mezi", phrase_id=None, language="rw")
    assert plan["mode"] == "pindo_tts"
    assert plan["audio_url"] == "https://cdn.example/pindo.mp3"


def test_speak_plan_rw_prefers_pack_when_present(monkeypatch):
    monkeypatch.setenv("PINDO_API_TOKEN", "test-token")
    monkeypatch.setenv("PINDO_ACCESS_MODE", "authenticated")
    called = {"n": 0}

    def fake_synth(text, cache_key=None, speech_rate=1.0, timeout=12.0):
        called["n"] += 1
        return {"ok": True, "audio_url": "https://cdn.example/human-rw.mp3", "mode": "pindo_tts"}

    monkeypatch.setattr("app.services.ai.pindo_tts.synthesize_rw", fake_synth)
    monkeypatch.setattr("app.services.ai.voice_stt._pack_mp3", lambda lang, phrase_id: True)
    plan = speak_plan("Imyaka mu mezi", phrase_id="age", language="rw")
    assert plan["mode"] == "phrase_pack"
    assert plan["audio_url"] == "/audio/rw/age.mp3"
    assert called["n"] == 0


def test_speak_plan_rw_uses_pindo_when_pack_missing(monkeypatch):
    monkeypatch.setenv("PINDO_API_TOKEN", "test-token")
    monkeypatch.setenv("PINDO_ACCESS_MODE", "authenticated")

    def fake_synth(text, cache_key=None, speech_rate=1.0, timeout=12.0):
        return {"ok": True, "audio_url": "https://cdn.example/human-rw.mp3", "mode": "pindo_tts"}

    monkeypatch.setattr("app.services.ai.pindo_tts.synthesize_rw", fake_synth)
    monkeypatch.setattr("app.services.ai.voice_stt._pack_mp3", lambda lang, phrase_id: False)
    plan = speak_plan("Imyaka mu mezi", phrase_id="age", language="rw")
    assert plan["mode"] == "pindo_tts"
    assert plan["audio_url"] == "https://cdn.example/human-rw.mp3"
