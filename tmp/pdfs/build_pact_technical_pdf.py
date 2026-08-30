from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path("/Users/saraiva/hacka")
OUTPUT = ROOT / "output/pdf/pact-volta-diagrama-tecnico.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 34

BG = HexColor("#090B0E")
SURFACE = HexColor("#11151A")
SURFACE_2 = HexColor("#171C22")
BORDER = HexColor("#29313A")
GRID = HexColor("#151A20")
WHITE = HexColor("#F4F7FA")
MUTED = HexColor("#9AA5B1")
DIM = HexColor("#697481")
LIME = HexColor("#D4FF36")
CYAN = HexColor("#30D7D2")
BLUE = HexColor("#5C8CFF")
ORANGE = HexColor("#FF9F43")
VIOLET = HexColor("#A881FF")
GREEN = HexColor("#62DB8B")
ROSE = HexColor("#FF6D85")
RED = HexColor("#FF5D6C")


def register_fonts() -> None:
    fonts = {
        "Arial": "/System/Library/Fonts/Supplemental/Arial.ttf",
        "Arial-Bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "Arial-Italic": "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
        "Mono": "/System/Library/Fonts/SFNSMono.ttf",
    }
    for name, path in fonts.items():
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))


register_fonts()


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font, size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_grid(c: canvas.Canvas) -> None:
    c.setStrokeColor(GRID)
    c.setLineWidth(0.35)
    step = 34
    x = 0
    while x <= PAGE_W:
        c.line(x, 0, x, PAGE_H)
        x += step
    y = 0
    while y <= PAGE_H:
        c.line(0, y, PAGE_W, y)
        y += step


def start_page(c: canvas.Canvas, section: str, title: str, page: int) -> None:
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    draw_grid(c)
    c.setFillColor(LIME)
    c.roundRect(MARGIN, PAGE_H - 39, 22, 22, 5, fill=1, stroke=0)
    c.setFillColor(BG)
    c.setFont("Arial-Bold", 9)
    c.drawCentredString(MARGIN + 11, PAGE_H - 31.5, "P")
    c.setFillColor(MUTED)
    c.setFont("Arial-Bold", 7)
    c.drawString(MARGIN + 31, PAGE_H - 27, "PACT / VOLTA")
    c.setFillColor(DIM)
    c.setFont("Mono", 6.5)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 27, f"{section.upper()}  /  {page:02d}")
    c.setStrokeColor(BORDER)
    c.line(MARGIN, PAGE_H - 47, PAGE_W - MARGIN, PAGE_H - 47)
    c.setFillColor(WHITE)
    c.setFont("Arial-Bold", 22)
    c.drawString(MARGIN, PAGE_H - 77, title)
    c.setFillColor(DIM)
    c.setFont("Arial", 7)
    c.drawRightString(PAGE_W - MARGIN, 18, "Mapa técnico baseado no código do repositório - 30/08/2026")
    c.setStrokeColor(BORDER)
    c.line(MARGIN, 28, PAGE_W - MARGIN, 28)


def finish_page(c: canvas.Canvas) -> None:
    c.showPage()


def label(c: canvas.Canvas, x: float, y: float, text: str, color=LIME) -> None:
    c.setFillColor(color)
    c.setFont("Mono", 6.5)
    c.drawString(x, y, text.upper())


def box(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    title: str,
    body: str = "",
    accent=LIME,
    tag: str | None = None,
    bullets: list[str] | None = None,
    fill=SURFACE,
    title_size: float = 10,
    body_size: float = 7.2,
) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x, y, 3.5, h, 2, fill=1, stroke=0)
    tx = x + 13
    ty = y + h - 18
    if tag:
        c.setFont("Mono", 5.8)
        c.setFillColor(accent)
        c.drawString(tx, ty + 7, tag.upper())
        ty -= 4
    c.setFillColor(WHITE)
    c.setFont("Arial-Bold", title_size)
    for line in wrap(title, "Arial-Bold", title_size, w - 25):
        c.drawString(tx, ty, line)
        ty -= title_size + 2
    if body:
        ty -= 3
        c.setFillColor(MUTED)
        c.setFont("Arial", body_size)
        for line in wrap(body, "Arial", body_size, w - 25):
            if ty < y + 8:
                break
            c.drawString(tx, ty, line)
            ty -= body_size + 2.2
    if bullets:
        ty -= 2
        for item in bullets:
            c.setFillColor(accent)
            c.circle(tx + 2, ty + 2.2, 1.25, fill=1, stroke=0)
            c.setFillColor(MUTED)
            c.setFont("Arial", body_size)
            lines = wrap(item, "Arial", body_size, w - 35)
            for i, line in enumerate(lines):
                if ty < y + 8:
                    break
                c.drawString(tx + 8, ty, line)
                ty -= body_size + 2
            ty -= 2


def chip(c: canvas.Canvas, x: float, y: float, text: str, color=LIME, width: float | None = None) -> float:
    c.setFont("Mono", 5.7)
    w = width or pdfmetrics.stringWidth(text.upper(), "Mono", 5.7) + 15
    c.setFillColor(SURFACE_2)
    c.setStrokeColor(color)
    c.roundRect(x, y, w, 16, 8, fill=1, stroke=1)
    c.setFillColor(color)
    c.drawCentredString(x + w / 2, y + 5.2, text.upper())
    return w


def arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float, color=DIM, label_text: str | None = None) -> None:
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.15)
    c.line(x1, y1, x2, y2)
    import math

    angle = math.atan2(y2 - y1, x2 - x1)
    length = 6
    wing = 2.7
    p1 = (x2, y2)
    p2 = (x2 - length * math.cos(angle) + wing * math.sin(angle), y2 - length * math.sin(angle) - wing * math.cos(angle))
    p3 = (x2 - length * math.cos(angle) - wing * math.sin(angle), y2 - length * math.sin(angle) + wing * math.cos(angle))
    path = c.beginPath()
    path.moveTo(*p1)
    path.lineTo(*p2)
    path.lineTo(*p3)
    path.close()
    c.drawPath(path, fill=1, stroke=0)
    if label_text:
        c.setFillColor(DIM)
        c.setFont("Mono", 5.5)
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 5, label_text.upper())


def callout(c: canvas.Canvas, x: float, y: float, w: float, text: str, accent=LIME) -> None:
    c.setFillColor(HexColor("#14190F") if accent == LIME else SURFACE_2)
    c.setStrokeColor(accent)
    c.roundRect(x, y, w, 38, 7, fill=1, stroke=1)
    c.setFillColor(accent)
    c.setFont("Arial-Bold", 8.5)
    lines = wrap(text, "Arial-Bold", 8.5, w - 24)
    ty = y + 24
    for line in lines[:2]:
        c.drawString(x + 12, ty, line)
        ty -= 11


def page_cover(c: canvas.Canvas) -> None:
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    draw_grid(c)
    c.setFillColor(LIME)
    c.rect(0, 0, 10, PAGE_H, fill=1, stroke=0)
    c.setFillColor(DIM)
    c.setFont("Mono", 7)
    c.drawString(MARGIN + 20, PAGE_H - 55, "PACT / VOLTA   |   ARQUITETURA DA SOLUÇÃO")
    c.setFillColor(WHITE)
    c.setFont("Arial-Bold", 42)
    c.drawString(MARGIN + 20, PAGE_H - 132, "Diagrama técnico")
    c.setFillColor(LIME)
    c.setFont("Arial-Bold", 42)
    c.drawString(MARGIN + 20, PAGE_H - 178, "completo da solução")
    c.setFillColor(MUTED)
    c.setFont("Arial", 14)
    c.drawString(MARGIN + 20, PAGE_H - 217, "Da conversa de voz ao compromisso operacional verificável.")

    x0 = MARGIN + 20
    y0 = 166
    widths = [104, 104, 104, 104, 104, 104]
    names = [
        ("BRIEFING", CYAN),
        ("MERCADO", BLUE),
        ("VOZ", ORANGE),
        ("REALTIME", VIOLET),
        ("AUTORIDADE", GREEN),
        ("PROVA", ROSE),
    ]
    for i, ((name, color), w) in enumerate(zip(names, widths)):
        x = x0 + i * 116
        c.setFillColor(SURFACE)
        c.setStrokeColor(color)
        c.roundRect(x, y0, w, 76, 7, fill=1, stroke=1)
        c.setFillColor(color)
        c.circle(x + 17, y0 + 56, 4, fill=1, stroke=0)
        c.setFont("Mono", 6)
        c.drawString(x + 12, y0 + 20, name)
        if i < len(names) - 1:
            arrow(c, x + w, y0 + 38, x + 115, y0 + 38, color=DIM)

    callout(c, MARGIN + 20, 92, 470, "O modelo conversa. O servidor autoriza. A evidência fecha o compromisso.")
    c.setFillColor(DIM)
    c.setFont("Arial", 8)
    c.drawString(MARGIN + 20, 54, "Escopo: features presentes no código. Ativação de provedores e infraestrutura ao vivo requer revalidação.")
    c.setFont("Mono", 7)
    c.drawRightString(PAGE_W - MARGIN, 32, "30 / 08 / 2026")
    finish_page(c)


def page_master(c: canvas.Canvas) -> None:
    start_page(c, "Visão geral", "Mapa mestre da solução", 2)
    top = PAGE_H - 106
    col_w = 99
    gap = 12
    xs = [MARGIN + i * (col_w + gap) for i in range(7)]
    items = [
        ("Operador", "Briefing e mandato humano", CYAN),
        ("Command center", "Ações, mercado, transcript e auditoria", BLUE),
        ("Orquestração", "Scan, booking, renegociação e inbound", BLUE),
        ("Voz", "Telnyx, WaCalls e Twilio", ORANGE),
        ("Volta Realtime", "Áudio, transcrição e MCP", VIOLET),
        ("Autoridade", "Política, ranking e confirmação", GREEN),
        ("Compromisso", "Recap, áudio, evidência e ledger", ROSE),
    ]
    for i, (title, body, color) in enumerate(items):
        box(c, xs[i], top - 126, col_w, 126, title, body, accent=color, tag=f"L{i+1:02d}")
        if i < len(items) - 1:
            arrow(c, xs[i] + col_w, top - 63, xs[i + 1] - 2, top - 63, color=color)

    label(c, MARGIN, 322, "Saídas visíveis")
    output_titles = [
        "Comparação de mercado",
        "Transcrição final",
        "Decisões de autoridade",
        "Call brief estruturado",
        "Ledger do compromisso",
        "Evidência de áudio",
        "Escalação ao vivo",
        "Audit stream",
    ]
    ow = (PAGE_W - 2 * MARGIN - 7 * 8) / 8
    for i, title in enumerate(output_titles):
        x = MARGIN + i * (ow + 8)
        box(c, x, 255, ow, 54, title, accent=LIME if i in (4, 5) else BLUE, title_size=7.6, body_size=6)

    label(c, MARGIN, 225, "Serviços e runtime")
    runtime = [
        ("Vercel", "UI, APIs, MCP e webhooks"),
        ("Supabase", "Snapshot, ledger, jobs e Storage"),
        ("OpenAI", "Realtime e diarização"),
        ("Azure", "WaCalls persistente + Caddy"),
        ("Cloudflare", "Relay WebSocket do Twilio"),
        ("Resend", "Recap opcional por email"),
    ]
    rw = (PAGE_W - 2 * MARGIN - 5 * 11) / 6
    for i, (title, body) in enumerate(runtime):
        box(c, MARGIN + i * (rw + 11), 137, rw, 74, title, body, accent=ORANGE, tag="EXTERNO", title_size=8.5, body_size=6.4)

    callout(c, MARGIN, 69, PAGE_W - 2 * MARGIN, "Trust boundary: o modelo pode ouvir, falar e enviar fatos estruturados; não pode expandir o mandato humano.")
    finish_page(c)


def page_command_center(c: canvas.Canvas) -> None:
    start_page(c, "Produto", "Command center e features operacionais", 3)
    y = 356
    box(c, MARGIN, y, 225, 147, "A. Operation briefing", accent=CYAN, bullets=[
        "Referência, cliente, container/carga e rota",
        "Data e janela de coleta",
        "Meta, teto e moeda MXN",
        "Negociar preço, trocar dia e aceitar acessórios",
        "Limite de contrapropostas",
        "Três transportadoras, telefone e email",
        "Telefone de handoff por operação",
    ])
    box(c, MARGIN + 239, y, 225, 147, "Ações do operador", accent=BLUE, bullets=[
        "Salvar briefing",
        "Delegar operação",
        "Nova operação / reset",
        "Chamada de teste por transportadora",
        "Reservar vencedor",
        "Renegociar após mudança de briefing",
        "Simular exceção inbound",
        "Assumir chamada ao vivo",
    ])
    box(c, MARGIN + 478, y, 296, 147, "Estado e feedback", accent=LIME, bullets=[
        "Status do WaCalls e geração de QR Code",
        "Estados DRAFT, SCANNING, QUOTED, BOOKING, COMMITTED e AT_RISK",
        "Status de cada chamada: QUEUED, RINGING, IN_PROGRESS, COMPLETED e FAILED",
        "Erros acionáveis no painel",
        "Atualização periódica do snapshot durante o mercado",
    ])

    label(c, MARGIN, 330, "Superfícies de leitura A-H")
    panels = [
        ("B", "Market comparison", "Ranking e elegibilidade"),
        ("C", "Conversation transcript", "Turnos finais Realtime"),
        ("D", "Authority decisions", "ALLOW, BLOCK, SELECT, ESCALATE"),
        ("E", "Call brief", "Taxas, condições, mudanças e ações"),
        ("F", "Commitment ledger", "Estado canônico do acordo"),
        ("G", "Audio evidence", "Player do segmento confirmado"),
        ("H", "Audit stream", "Eventos e severidade"),
    ]
    pw = (PAGE_W - 2 * MARGIN - 6 * 8) / 7
    for i, (letter, title, body) in enumerate(panels):
        box(c, MARGIN + i * (pw + 8), 206, pw, 105, title, body, accent=[BLUE, VIOLET, GREEN, CYAN, ROSE, ROSE, LIME][i], tag=letter, title_size=8, body_size=6.2)

    callout(c, MARGIN, 143, 360, "A interface mostra o resultado, mas cada decisão é produzida no servidor.", accent=GREEN)
    callout(c, MARGIN + 380, 143, 394, "A operação é briefing-driven: a equipe informa os limites e o sistema trabalha o mercado.", accent=CYAN)

    label(c, MARGIN, 115, "Autenticação e experiência")
    x = MARGIN
    for text, color in [
        ("Login por código", LIME), ("Cookie de sessão JWT", GREEN), ("Logout", BLUE),
        ("Foco de teclado", CYAN), ("Reduced motion", VIOLET), ("Responsivo", ORANGE),
    ]:
        x += chip(c, x, 83, text, color) + 8
    finish_page(c)


def page_voice(c: canvas.Canvas) -> None:
    start_page(c, "Voz", "Camada de telefonia selecionável", 4)
    callout(c, MARGIN, 470, PAGE_W - 2 * MARGIN, "VOLTA_VOICE_TRANSPORT seleciona telnyx, whatsapp ou twilio atrás da mesma interface de discagem.", accent=ORANGE)
    cols = [MARGIN, MARGIN + 260, MARGIN + 520]
    titles = [
        ("Telnyx - PSTN principal", ORANGE, [
            "Outbound por TeXML",
            "Inbound de qualquer telefone",
            "SIP direto para OpenAI Realtime",
            "Headers X-Volta para correlação",
            "Gravação dual-channel",
            "Recap por SMS",
            "Handoff por SIP REFER",
            "Webhook Ed25519 com tolerância de replay",
        ]),
        ("WaCalls - WhatsApp fallback", CYAN, [
            "Pareamento por QR e sessão SQLite",
            "Allowlist de números consentidos",
            "Outbound e inbound WhatsApp",
            "PCM bidirecional, resample e pacing",
            "Barge-in e cancelamento de playback",
            "WAV mono com timeline",
            "Recap por WhatsApp",
            "Takeover WebRTC no navegador",
        ]),
        ("Twilio - compatibilidade", VIOLET, [
            "Conference ou Media Streams",
            "Relay WebSocket em Cloudflare Worker",
            "Token efêmero para Realtime",
            "Recording callback",
            "Recap por SMS",
            "Perna humana de takeover",
            "Validação de assinatura HMAC",
            "Correla stream, call e operação",
        ]),
    ]
    for x, (title, color, bullets) in zip(cols, titles):
        box(c, x, 230, 234, 218, title, accent=color, tag="TRANSPORTE", bullets=bullets, title_size=11, body_size=7)

    label(c, MARGIN, 199, "Fluxo comum")
    nodes = [
        ("CallAttempt", BLUE), ("dialVoiceCall", ORANGE), ("Provedor", ORANGE),
        ("OpenAI Realtime", VIOLET), ("Eventos finais", CYAN), ("Snapshot + ledger", GREEN),
    ]
    nw = 105
    for i, (title, color) in enumerate(nodes):
        x = MARGIN + i * 126
        box(c, x, 121, nw, 57, title, accent=color, title_size=8.2)
        if i < len(nodes) - 1:
            arrow(c, x + nw, 149, x + 124, 149, color=color)
    c.setFillColor(MUTED)
    c.setFont("Arial", 7.2)
    c.drawString(MARGIN, 88, "Fallback honesto: WhatsApp é chamada real em telefone, mas não é PSTN. A ativação ao vivo depende de provedor, número, credenciais e rede.")
    finish_page(c)


def page_realtime_mcp(c: canvas.Canvas) -> None:
    start_page(c, "IA em tempo real", "Volta Realtime e ferramentas MCP", 5)
    label(c, MARGIN, 480, "Sessão de voz")
    session = [
        ("Áudio de entrada", "PCMU ou PCM", ORANGE),
        ("Near-field", "Redução de ruído", CYAN),
        ("Server VAD", "Turnos + barge-in", VIOLET),
        ("gpt-realtime-2.1", "Voz marin / espanhol", LIME),
        ("Áudio de saída", "Interrompível", ORANGE),
    ]
    sw = 132
    for i, (title, body, color) in enumerate(session):
        x = MARGIN + i * 151
        box(c, x, 398, sw, 67, title, body, accent=color, title_size=8.7, body_size=6.5)
        if i < len(session) - 1:
            arrow(c, x + sw, 431, x + 149, 431, color=color)

    label(c, MARGIN, 367, "Contrato MCP stateless")
    tools = [
        ("get_operation_context", "Lê operação, mandato, ofertas e compromisso."),
        ("record_offer", "Registra revisão; política decide elegibilidade."),
        ("stage_booking", "Gera recap canônico sem confirmar booking."),
        ("confirm_booking", "Exige sim inequívoco e token válido."),
        ("report_operational_change", "Avalia mudança sem expandir autoridade."),
        ("request_handoff", "Cria escalação humana na chamada ativa."),
    ]
    tw = (PAGE_W - 2 * MARGIN - 2 * 12) / 3
    for i, (title, body) in enumerate(tools):
        row = i // 3
        col = i % 3
        box(c, MARGIN + col * (tw + 12), 281 - row * 84, tw, 69, title, body, accent=VIOLET, tag=f"TOOL {i+1}", title_size=8.4, body_size=6.6)

    label(c, MARGIN, 184, "Transcrição e correlação")
    box(c, MARGIN, 92, 244, 78, "Transcrição final idempotente", "Armazena somente turnos finais do agente e da contraparte. Remove eco de contexto durante silêncio.", accent=CYAN)
    box(c, MARGIN + 260, 92, 244, 78, "Decision trace", "Liga ofertas e decisões ao último segmento relevante e mantém reason codes.", accent=GREEN)
    box(c, MARGIN + 520, 92, 254, 78, "Call brief automático", "Consolida taxas, condições, correções, ações e menções ao fim da chamada.", accent=BLUE)
    finish_page(c)


def page_authority(c: canvas.Canvas) -> None:
    start_page(c, "Autoridade", "Motor determinístico de mandato", 6)
    callout(c, MARGIN, 473, PAGE_W - 2 * MARGIN, "Nenhum limite depende de o modelo obedecer ao prompt: todos são avaliados server-side.", accent=GREEN)
    checks = [
        ("Moeda", "currency_mismatch", "MXN obrigatório"),
        ("Teto", "rate_above_mandate", "Oferta <= maximumRate"),
        ("Dia", "pickup_day_outside_mandate", "Data exata do briefing"),
        ("Janela", "pickup_time_outside_window", "Horário dentro do intervalo"),
        ("Acessórios", "unsupported_accessorial", "Condições extras autorizadas"),
        ("Counters", "counter_limit_exhausted", "Budget por transportadora"),
        ("Negociação", "rate_negotiation_not_authorized", "Sem permissão, só primeira oferta"),
        ("Mudança", "pickup_day_change_not_authorized", "Troca de dia bloqueada"),
    ]
    cw = (PAGE_W - 2 * MARGIN - 3 * 10) / 4
    for i, (title, code, desc) in enumerate(checks):
        row = i // 4
        col = i % 4
        box(c, MARGIN + col * (cw + 10), 359 - row * 104, cw, 90, title, desc, accent=GREEN, tag=code, title_size=9, body_size=6.7)

    label(c, MARGIN, 240, "Correções, idempotência e ranking")
    box(c, MARGIN, 132, 238, 92, "Oferta em revisões", accent=BLUE, bullets=[
        "Nova posição supersede a anterior",
        "Restatement retorna a revisão vigente",
        "Retry não consome contraproposta",
    ])
    box(c, MARGIN + 254, 132, 238, 92, "Ranking policy-first", accent=LIME, bullets=[
        "Filtra somente ofertas elegíveis",
        "Menor taxa vence",
        "Desempate: horário e nome estável",
    ])
    box(c, MARGIN + 508, 132, 266, 92, "Bookability revalidada", accent=ROSE, bullets=[
        "Oferta deve ser a vencedora atual",
        "Oferta superseded não pode reservar",
        "Mandato é reavaliado antes do stage",
    ])
    callout(c, MARGIN, 75, PAGE_W - 2 * MARGIN, "Se todas as ofertas forem bloqueadas, o sistema não para em silêncio: abre escalação humana.", accent=RED)
    finish_page(c)


def page_operation_flow(c: canvas.Canvas) -> None:
    start_page(c, "Fluxo", "Operação ponta a ponta", 7)
    nodes = {
        "DRAFT": (MARGIN, 407, 105, 58, CYAN),
        "SCANNING": (169, 407, 105, 58, BLUE),
        "POLICY": (304, 407, 105, 58, GREEN),
        "QUOTED": (456, 407, 105, 58, BLUE),
        "BOOKING": (603, 407, 105, 58, ORANGE),
        "PROPOSED": (603, 303, 105, 58, ROSE),
        "VERBAL": (456, 303, 105, 58, ROSE),
        "RECAP": (304, 303, 105, 58, VIOLET),
        "EVIDENCE": (169, 303, 105, 58, VIOLET),
        "COMMITTED": (MARGIN, 303, 105, 58, LIME),
        "AT_RISK": (304, 179, 105, 58, RED),
        "TAKEOVER": (456, 179, 105, 58, ORANGE),
        "HUMAN": (603, 179, 105, 58, CYAN),
        "RENEG": (169, 179, 105, 58, BLUE),
    }
    descriptions = {
        "DRAFT": "briefing salvo", "SCANNING": "3 calls de quote", "POLICY": "ofertas avaliadas",
        "QUOTED": "mercado fechado", "BOOKING": "call do vencedor", "PROPOSED": "recap + token",
        "VERBAL": "sim inequívoco", "RECAP": "texto entregue", "EVIDENCE": "áudio alinhado",
        "COMMITTED": "acordo verificado", "AT_RISK": "fora do mandato", "TAKEOVER": "transferência viva",
        "HUMAN": "operador assume", "RENEG": "reabre acordo",
    }
    for key, (x, y, w, h, color) in nodes.items():
        box(c, x, y, w, h, key, descriptions[key], accent=color, title_size=8.6, body_size=6.1)

    def mid_right(k):
        x, y, w, h, _ = nodes[k]
        return x + w, y + h / 2
    def mid_left(k):
        x, y, w, h, _ = nodes[k]
        return x, y + h / 2
    def mid_bottom(k):
        x, y, w, h, _ = nodes[k]
        return x + w / 2, y
    def mid_top(k):
        x, y, w, h, _ = nodes[k]
        return x + w / 2, y + h

    for a, b, text in [
        ("DRAFT", "SCANNING", "delegar"), ("SCANNING", "POLICY", "oferta"),
        ("POLICY", "QUOTED", "elegível"), ("QUOTED", "BOOKING", "auto-book"),
    ]:
        arrow(c, *mid_right(a), *mid_left(b), label_text=text)
    for a, b, text in [
        ("BOOKING", "PROPOSED", "stage"), ("PROPOSED", "VERBAL", "confirmar"),
        ("VERBAL", "RECAP", "mensagem"), ("RECAP", "EVIDENCE", "gate"),
        ("EVIDENCE", "COMMITTED", "fechar"),
    ]:
        if a == "BOOKING":
            arrow(c, *mid_bottom(a), *mid_top(b), label_text=text)
        else:
            arrow(c, *mid_left(a), *mid_right(b), label_text=text)
    # Route the blocked-offer branch through the gap between the middle-row
    # cards so the connector never crosses the RECAP node.
    px, py = mid_bottom("POLICY")
    ax, ay = mid_top("AT_RISK")
    route_x = 432
    c.setStrokeColor(RED)
    c.setLineWidth(1.15)
    c.line(px, py, px, 380)
    c.line(px, 380, route_x, 380)
    c.line(route_x, 380, route_x, 260)
    c.line(route_x, 260, ax, 260)
    arrow(c, ax, 260, ax, ay, color=RED)
    c.saveState()
    c.translate(route_x + 5, 321)
    c.rotate(90)
    c.setFillColor(RED)
    c.setFont("Mono", 5.5)
    c.drawCentredString(0, 0, "SEM ELEGÍVEL")
    c.restoreState()
    arrow(c, *mid_right("AT_RISK"), *mid_left("TAKEOVER"), color=RED, label_text="escalar")
    arrow(c, *mid_right("TAKEOVER"), *mid_left("HUMAN"), color=ORANGE, label_text="conectar")
    arrow(c, *mid_left("AT_RISK"), *mid_right("RENEG"), color=BLUE, label_text="briefing mudou")

    callout(c, MARGIN, 90, 370, "Modo demo: simula mercado e recap, mas para em RECAP_SENT sem fabricar evidência.", accent=ORANGE)
    callout(c, MARGIN + 388, 90, 386, "Operação ao vivo: todas as chamadas finalizam antes do auto-book; falhas também contam para o settle.", accent=BLUE)
    finish_page(c)


def page_commitment(c: canvas.Canvas) -> None:
    start_page(c, "Compromisso", "Máquina de estados e gates de verificação", 8)
    states = [
        ("PROPOSED", "Recap canônico e token temporário", ROSE),
        ("VERBALLY_CONFIRMED", "Resposta curta, afirmativa e sem condição", ROSE),
        ("RECAP_SENT", "SMS, WhatsApp e/ou email entregue", VIOLET),
        ("EVIDENCE_LINKED", "Segmento confirmado no áudio", VIOLET),
        ("COMMITTED", "Todos os gates satisfeitos", LIME),
    ]
    x = MARGIN
    y = 398
    sw = 133
    for i, (title, body, color) in enumerate(states):
        box(c, x + i * 153, y, sw, 84, title, body, accent=color, title_size=7.7, body_size=6.5)
        if i < len(states) - 1:
            arrow(c, x + i * 153 + sw, y + 42, x + (i + 1) * 153 - 3, y + 42, color=color)

    label(c, MARGIN, 365, "Confirmação canônica")
    box(c, MARGIN, 246, 232, 103, "Aceita", accent=GREEN, bullets=[
        "Começa com afirmativa real",
        "Até 10 palavras",
        "Sem hedge, condição ou contradição",
        "Token válido e oferta ainda bookable",
    ])
    box(c, MARGIN + 247, 246, 232, 103, "Recusa", accent=RED, bullets=[
        "'Sim, mas muda o horário'",
        "Apenas backchannel: ok, vale, listo",
        "Aprovação atribuída a terceiro",
        "Resposta longa ou ambígua",
    ])
    box(c, MARGIN + 494, 246, 280, 103, "Fail closed", "Se a confirmação não for inequívoca, o booking não avança. O agente pede uma resposta clara em vez de inferir consentimento.", accent=ORANGE, tag="REGRA")

    label(c, MARGIN, 217, "Saídas laterais permitidas")
    side_states = [
        ("REJECTED", "Recusa explícita", RED),
        ("SUPERSEDED", "Briefing alterado", BLUE),
        ("VERIFICATION_FAILED", "Áudio sem segmento válido", ORANGE),
        ("ESCALATED", "Limite de autoridade", RED),
    ]
    ww = (PAGE_W - 2 * MARGIN - 3 * 12) / 4
    for i, (title, body, color) in enumerate(side_states):
        box(c, MARGIN + i * (ww + 12), 122, ww, 78, title, body, accent=color, title_size=8.5, body_size=6.4)
    callout(c, MARGIN, 70, PAGE_W - 2 * MARGIN, "A interface nunca apresenta COMMITTED antes de confirmação verbal, recap escrito e evidência de áudio.", accent=LIME)
    finish_page(c)


def page_evidence(c: canvas.Canvas) -> None:
    start_page(c, "Evidência", "Gravação, recap e prova auditável", 9)
    label(c, MARGIN, 480, "Pipeline de evidência")
    pipeline = [
        ("Áudio real", "Telnyx dual ou WaCalls WAV", ORANGE),
        ("Storage privado", "supabase:// ou URL protegida", BLUE),
        ("Job durável", "dedupe + até 4 tentativas", GREEN),
        ("Diarização", "gpt-4o-transcribe-diarize", VIOLET),
        ("Matcher", "último sim inequívoco", ROSE),
        ("Segmento", "speaker + texto + timestamps", LIME),
    ]
    pw = 111
    for i, (title, body, color) in enumerate(pipeline):
        x = MARGIN + i * 128
        box(c, x, 390, pw, 75, title, body, accent=color, title_size=8.2, body_size=6.1)
        if i < len(pipeline) - 1:
            arrow(c, x + pw, 427, x + 126, 427, color=color)

    label(c, MARGIN, 357, "Recap multicanal")
    box(c, MARGIN, 242, 236, 100, "Texto canônico", "Transportadora, rota, data, hora e taxa saem do compromisso no servidor.", accent=ROSE, tag="FONTE ÚNICA")
    box(c, MARGIN + 252, 242, 236, 100, "Canais", accent=VIOLET, bullets=[
        "WhatsApp quando transporte WaCalls",
        "SMS em Telnyx ou Twilio",
        "Email opcional via Resend",
        "Um canal entregue é suficiente",
    ])
    box(c, MARGIN + 504, 242, 270, 100, "Falha observável", accent=RED, bullets=[
        "Nenhum canal entregue: recap.failed",
        "Um falha e outro entrega: recap.partial",
        "Referências dos provedores no ledger",
        "Sem entrega, compromisso não avança",
    ])

    label(c, MARGIN, 210, "O que o player comprova")
    boxes = [
        ("Identidade", "speaker diarizado"),
        ("Conteúdo", "texto afirmativo"),
        ("Momento", "start/end em segundos"),
        ("Origem", "callId + storagePath"),
        ("Vínculo", "commitmentId + offerId"),
    ]
    bw = (PAGE_W - 2 * MARGIN - 4 * 9) / 5
    for i, (title, body) in enumerate(boxes):
        box(c, MARGIN + i * (bw + 9), 120, bw, 73, title, body, accent=CYAN, title_size=8.3, body_size=6.5)
    callout(c, MARGIN, 68, PAGE_W - 2 * MARGIN, "Sem gravação não existe evidência. O modo demo registra essa ausência e não fabrica um timestamp.", accent=ORANGE)
    finish_page(c)


def page_handoff(c: canvas.Canvas) -> None:
    start_page(c, "Exceções", "Mudanças operacionais e handoff humano", 10)
    label(c, MARGIN, 480, "Detecção e decisão")
    flow = [
        ("Chamada inbound", "conhecida ou não", ORANGE),
        ("Mudança pedida", "dia, preço ou condição", CYAN),
        ("Mandate engine", "observa ou bloqueia", GREEN),
        ("Escalação", "OPEN -> DIALING", RED),
        ("Takeover", "sem desligar", VIOLET),
        ("Humano", "CONNECTED", LIME),
    ]
    fw = 111
    for i, (title, body, color) in enumerate(flow):
        x = MARGIN + i * 128
        box(c, x, 394, fw, 70, title, body, accent=color, title_size=8.3, body_size=6.4)
        if i < len(flow) - 1:
            arrow(c, x + fw, 429, x + 126, 429, color=color)

    label(c, MARGIN, 363, "Canais de continuidade")
    box(c, MARGIN, 234, 236, 112, "Telnyx", accent=ORANGE, bullets=[
        "OpenAI REFER para domínio SIP Telnyx",
        "Usa telefone de handoff do briefing",
        "Contraparte permanece na chamada",
    ])
    box(c, MARGIN + 252, 234, 236, 112, "WaCalls", accent=CYAN, bullets=[
        "Oferta SDP do navegador",
        "WebRTC assume a mídia da chamada",
        "GPT é destacado depois da ponte",
        "Microfone exige permissão local",
    ])
    box(c, MARGIN + 504, 234, 270, 112, "Twilio", accent=VIOLET, bullets=[
        "Cria perna humana na conferência",
        "Telefone de handoff por operação ou env",
        "Mantém conferenceName correlacionado",
    ])

    label(c, MARGIN, 203, "Estados e garantias")
    guarantees = [
        ("OPEN", "conflito visível"),
        ("DIALING", "ponte em preparação"),
        ("CONNECTED", "humano na mídia"),
        ("RESOLVED", "exceção encerrada"),
    ]
    for i, (title, body) in enumerate(guarantees):
        box(c, MARGIN + i * 190, 123, 173, 64, title, body, accent=[RED, ORANGE, LIME, BLUE][i], title_size=8.5, body_size=6.5)
    callout(c, MARGIN, 70, PAGE_W - 2 * MARGIN, "O bloqueio cria a escalação no servidor mesmo que o modelo nunca chame request_handoff.", accent=RED)
    finish_page(c)


def page_data_security(c: canvas.Canvas) -> None:
    start_page(c, "Fundação", "Dados, concorrência, segurança e deploy", 11)
    label(c, MARGIN, 480, "Persistência")
    box(c, MARGIN, 356, 238, 106, "Snapshot da operação", accent=BLUE, bullets=[
        "Uma operação MVP por snapshot",
        "Versão otimista",
        "Fila de escrita no processo",
        "Retry com backoff e jitter",
    ])
    box(c, MARGIN + 254, 356, 238, 106, "Ledger append-only", accent=GREEN, bullets=[
        "Eventos operacionais",
        "Decisões e reason codes",
        "Correlação com callId",
        "Idempotency keys",
    ])
    box(c, MARGIN + 508, 356, 266, 106, "Supabase", accent=CYAN, bullets=[
        "Postgres para estado durável",
        "volta_events para auditoria",
        "volta_jobs para processamento",
        "Storage privado + RLS",
    ])

    label(c, MARGIN, 326, "Controles de segurança")
    sec = [
        ("Operator auth", "Código, cookie JWT e rate limit"),
        ("MCP", "Bearer secret opcional"),
        ("Relay", "Shared secret + HMAC por callId"),
        ("Webhooks", "OpenAI unwrap, Telnyx Ed25519, Twilio HMAC"),
        ("WhatsApp", "Token API e allowlist E.164"),
        ("Storage", "Service role no servidor e bucket privado"),
    ]
    sw = (PAGE_W - 2 * MARGIN - 2 * 10) / 3
    for i, (title, body) in enumerate(sec):
        row = i // 3
        col = i % 3
        box(c, MARGIN + col * (sw + 10), 245 - row * 82, sw, 68, title, body, accent=GREEN, title_size=8.5, body_size=6.4)

    label(c, MARGIN, 150, "Topologia de runtime")
    runtime = [
        ("Vercel", "Next.js command center, APIs, webhooks e MCP"),
        ("Supabase", "Banco, jobs e gravações privadas"),
        ("Azure VPS", "WaCalls, SQLite, systemd, Caddy e UDP restrito"),
        ("Cloudflare", "Worker de Media Streams no caminho Twilio"),
    ]
    rw = (PAGE_W - 2 * MARGIN - 3 * 12) / 4
    for i, (title, body) in enumerate(runtime):
        box(c, MARGIN + i * (rw + 12), 76, rw, 62, title, body, accent=ORANGE, tag="RUNTIME", title_size=8.5, body_size=6.1)
    finish_page(c)


def page_inventory(c: canvas.Canvas) -> None:
    start_page(c, "Escopo", "Inventário completo e limites de prova", 12)
    label(c, MARGIN, 480, "Cobertura funcional")
    groups = [
        ("Briefing", "Operação, rota, janela, mandato, carriers, email e handoff", CYAN),
        ("Mercado", "Quotes, correções, ranking, settle, auto-book e renegociação", BLUE),
        ("Conversa", "Outbound, inbound, espanhol, barge-in, transcript e call brief", VIOLET),
        ("Autoridade", "8 limites, idempotência, reason codes e fail-closed", GREEN),
        ("Booking", "Recap canônico, token e confirmação inequívoca", ROSE),
        ("Evidência", "Recording, Storage, fila, diarização e player", ROSE),
        ("Exceções", "Mudança, escalação, REFER, WebRTC e conference", ORANGE),
        ("Observabilidade", "Snapshot, decisões, transcript, brief e audit stream", BLUE),
        ("Transportes", "Telnyx, WaCalls e Twilio/Cloudflare", ORANGE),
        ("Segurança", "Sessão, rate limit, assinaturas, secrets, allowlist e RLS", GREEN),
        ("Operação", "Vercel, Supabase, Azure, jobs, demo e testes", LIME),
        ("Qualidade", "Vitest, contention, contratos, Go, build e Playwright", CYAN),
    ]
    gw = (PAGE_W - 2 * MARGIN - 3 * 9) / 4
    for i, (title, body, color) in enumerate(groups):
        row = i // 4
        col = i % 4
        box(c, MARGIN + col * (gw + 9), 391 - row * 92, gw, 78, title, body, accent=color, title_size=8.8, body_size=6.3)

    label(c, MARGIN, 192, "Limites honestos")
    box(c, MARGIN, 82, 368, 96, "Presença no código não prova runtime ao vivo", accent=RED, bullets=[
        "Conta, número, compliance e rotas do provedor precisam estar ativos",
        "Credenciais, webhooks e gravação devem ser testados ponta a ponta",
        "WaCalls depende de VPS, Caddy e sessão WhatsApp saudável",
        "Handoff exige mídia bidirecional e operador realmente conectado",
    ])
    box(c, MARGIN + 386, 82, 388, 96, "Fronteira deliberada do MVP", accent=ORANGE, bullets=[
        "Snapshot centrado em uma operação principal, não multi-tenant completo",
        "WhatsApp é transporte real de voz, mas não é PSTN",
        "Modo demo para em RECAP_SENT sem evidência de áudio",
        "COMMITTED requer prova verificável, não apenas resultado visual",
    ])
    finish_page(c)


def build() -> None:
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("Pact / Volta - Diagrama técnico completo da solução")
    c.setAuthor("Saraiva.AI")
    c.setSubject("Arquitetura, features, fluxos, autoridade, evidência e infraestrutura")
    page_cover(c)
    page_master(c)
    page_command_center(c)
    page_voice(c)
    page_realtime_mcp(c)
    page_authority(c)
    page_operation_flow(c)
    page_commitment(c)
    page_evidence(c)
    page_handoff(c)
    page_data_security(c)
    page_inventory(c)
    c.save()


if __name__ == "__main__":
    build()
    print(OUTPUT)
