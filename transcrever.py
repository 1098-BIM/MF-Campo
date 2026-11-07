"""MF Campo — robô de transcrição.
Busca no Supabase as ocorrências com áudio pendente, transcreve com a API da OpenAI
e grava o texto no campo "transcricao". Roda no GitHub Actions (ver .github/workflows/transcrever.yml).
"""
import os, sys, json, time, mimetypes
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
OPENAI_KEY = os.environ["OPENAI_API_KEY"]
MODELO = os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
BUCKET = "evidencias"

H = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
HJ = dict(H, **{"Content-Type": "application/json", "Prefer": "return=minimal"})


def pendentes():
    r = requests.get(f"{SUPABASE_URL}/rest/v1/ocorrencias",
                     params={"select": "id,codigo,audios,transcricao_status", "transcricao_status": "in.(pendente,erro)",
                             "order": "criado_em.asc", "limit": "40"}, headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


def set_status(oid, status, texto=None):
    body = {"transcricao_status": status}
    if texto is not None:
        body["transcricao"] = texto
    r = requests.patch(f"{SUPABASE_URL}/rest/v1/ocorrencias", params={"id": f"eq.{oid}"}, headers=HJ, data=json.dumps(body), timeout=60)
    r.raise_for_status()


def baixar(path):
    r = requests.get(f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}", headers=H, timeout=120)
    r.raise_for_status()
    return r.content


def transcrever(nome, conteudo, mime):
    ext = os.path.splitext(nome)[1].lower() or ".m4a"
    # a API aceita m4a, mp3, mp4, mpeg, mpga, wav, webm, ogg
    arquivo = ("audio" + ext, conteudo, mime or mimetypes.guess_type(nome)[0] or "application/octet-stream")
    for tentativa in range(3):
        r = requests.post("https://api.openai.com/v1/audio/transcriptions",
                          headers={"Authorization": f"Bearer {OPENAI_KEY}"},
                          files={"file": arquivo},
                          data={"model": MODELO, "language": "pt", "response_format": "json",
                                "prompt": "Relato de incompatibilidade em obra de engenharia (BIM, HVAC, hidráulica, elétrica, estrutura)."},
                          timeout=300)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(10 * (tentativa + 1)); continue
        if r.status_code == 400 and MODELO != "whisper-1":
            # formato não aceito pelo modelo novo: tenta o whisper-1
            r = requests.post("https://api.openai.com/v1/audio/transcriptions",
                              headers={"Authorization": f"Bearer {OPENAI_KEY}"}, files={"file": arquivo},
                              data={"model": "whisper-1", "language": "pt", "response_format": "json"}, timeout=300)
        r.raise_for_status()
        return r.json().get("text", "").strip()
    r.raise_for_status()


def main():
    itens = pendentes()
    print(f"{len(itens)} ocorrência(s) com transcrição pendente")
    erros = 0
    for oc in itens:
        audios = oc.get("audios") or []
        if not audios:
            set_status(oc["id"], "nao_aplica"); continue
        set_status(oc["id"], "processando")
        partes = []
        try:
            for i, a in enumerate(audios, 1):
                conteudo = baixar(a["path"])
                texto = transcrever(a["path"], conteudo, a.get("mime"))
                partes.append(texto if len(audios) == 1 else f"[Áudio {i}] {texto}")
            set_status(oc["id"], "concluida", "\n".join(partes))
            print(f"  ok  {oc['codigo']}: {len(partes)} áudio(s)")
        except Exception as e:  # noqa: BLE001
            erros += 1
            print(f"  ERRO {oc['codigo']}: {e}")
            set_status(oc["id"], "erro")
    if erros:
        sys.exit(1)


if __name__ == "__main__":
    main()
