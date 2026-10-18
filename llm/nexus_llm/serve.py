"""Serveur d'inférence local du Nexus LLM — stdlib uniquement.

Aucun framework web, aucun appel sortant : un simple `http.server` qui
charge le checkpoint et expose, sur 127.0.0.1 par défaut :

    GET  /health   -> {ok, model, step, params, vocab}
    POST /generate -> {prompt, max_tokens, temperature, top_k, top_p,
                       repetition_penalty, seed}
                      renvoie {text, prompt}

Le tokenizer est celui enregistré dans les métadonnées du checkpoint
(résolution automatique, voir generate.load_all). Les générations sont
sérialisées par un verrou : sur 2 cœurs, deux décodages simultanés se
marcheraient dessus sans rien gagner.

C'est ce serveur que l'application Nexus interroge (voir
`src/lib/brain/llm-local.ts`) — en local, jamais via un tiers.

    python -m nexus_llm.serve --port 8765
"""
from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .generate import load_all, generate_text

ROOT = Path(__file__).resolve().parents[1]
STATE: dict = {}
GEN_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            meta = STATE["meta"]
            self._json(200, {
                "ok": True,
                "model": "nexus-llm (GPT NumPy, entraîné de zéro)",
                "step": meta.get("step"),
                "train_loss": meta.get("train_loss"),
                "val_loss": meta.get("val_loss"),
                "tokenizer": meta.get("tokenizer"),
                "params": STATE["model"].num_params(),
                "vocab": STATE["tok"].model_vocab_size,
            })
        else:
            self._json(404, {"error": "route inconnue"})

    def do_POST(self):
        if self.path != "/generate":
            self._json(404, {"error": "route inconnue"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length) or b"{}")
            prompt = str(req.get("prompt", "")).strip()
            if not prompt:
                self._json(400, {"error": "prompt manquant"})
                return
            with GEN_LOCK:  # un décodage à la fois (2 cœurs)
                text = generate_text(
                    STATE["model"], STATE["tok"],
                    prompt=prompt,
                    max_new_tokens=min(int(req.get("max_tokens", 120)), 512),
                    temperature=float(req.get("temperature", 0.9)),
                    top_k=int(req.get("top_k", 40)),
                    top_p=float(req.get("top_p", 0.95)),
                    repetition_penalty=float(req.get("repetition_penalty", 1.1)),
                    seed=req.get("seed"),
                )
            self._json(200, {"text": text, "prompt": prompt})
        except Exception as exc:  # noqa: BLE001 - renvoyer l'erreur proprement
            self._json(500, {"error": f"{type(exc).__name__}: {exc}"})


def main() -> None:
    ap = argparse.ArgumentParser(description="Serveur d'inférence local du Nexus LLM")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--ckpt", default=str(ROOT / "checkpoints/nexus-llm.npz"))
    ap.add_argument("--tokenizer", default=None,
                    help="par défaut : celui enregistré dans le checkpoint")
    args = ap.parse_args()

    model, tok, meta = load_all(args.ckpt, args.tokenizer)
    STATE.update(model=model, tok=tok, meta=meta)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[serve] Nexus LLM ({model.num_params() / 1e6:.2f} M params, étape "
          f"{meta.get('step', '?')}, tokenizer {meta.get('tokenizer')}) "
          f"sur http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
