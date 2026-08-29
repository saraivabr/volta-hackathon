"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Headphones,
  LogOut,
  Phone,
  PhoneCall,
  Play,
  QrCode,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { CallAttempt, Offer, OperationSnapshot, Severity } from "@/lib/domain/types";
import { latestOffers, rankOffers } from "@/lib/domain/policy";

type Action = "scan" | "book" | "takeover" | "simulate-inbound" | "reset" | "save";

interface WhatsAppStatus {
  configured: boolean;
  paired: boolean;
  state: string;
  sessionId?: string;
  qrDataUrl?: string | null;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const shortTime = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function statusTone(status: string) {
  if (["COMMITTED", "COMPLETED", "CONNECTED", "SUCCESS", "EVIDENCE_LINKED", "ALLOW", "SELECT"].includes(status)) return "verified";
  if (["AT_RISK", "FAILED", "DANGER", "REJECTED", "VERIFICATION_FAILED", "BLOCK", "ESCALATE"].includes(status)) return "danger";
  if (["SCANNING", "RINGING", "IN_PROGRESS", "BOOKING", "WARNING", "DIALING"].includes(status)) return "warning";
  return "neutral";
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`status-pill ${statusTone(status)}`}>
      <span className="status-dot" />
      {label ?? status.replaceAll("_", " ")}
    </span>
  );
}

function carrierCall(snapshot: OperationSnapshot, carrierId: string): CallAttempt | undefined {
  return [...snapshot.calls]
    .reverse()
    .find((call) => call.carrierId === carrierId && call.mode === "QUOTE");
}

function currentOffer(snapshot: OperationSnapshot, carrierId: string): Offer | undefined {
  return latestOffers(snapshot.offers).find((offer) => offer.carrierId === carrierId);
}

export function Dashboard({ initialSnapshot }: { initialSnapshot: OperationSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [whatsapp, setWhatsApp] = useState<WhatsAppStatus | null>(null);
  const [form, setForm] = useState({
    pickupDate: snapshot.operation.pickupDate,
    pickupWindowStart: snapshot.operation.pickupWindowStart,
    pickupWindowEnd: snapshot.operation.pickupWindowEnd,
    targetRate: snapshot.mandate.targetRate,
    maximumRate: snapshot.mandate.maximumRate,
    carrierPhones: Object.fromEntries(snapshot.carriers.map((carrier) => [carrier.id, carrier.phoneE164])),
  });
  const evidenceAudio = useRef<HTMLAudioElement>(null);
  const ranked = useMemo(() => rankOffers(snapshot), [snapshot]);
  const winningOffer = ranked[0];
  const winningCarrier = snapshot.carriers.find((carrier) => carrier.id === winningOffer?.carrierId);
  const hasQuoteCalls = snapshot.calls.some((call) => call.mode === "QUOTE");
  const transcripts = useMemo(
    () => [...(snapshot.transcripts ?? [])].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    [snapshot.transcripts],
  );
  const decisions = snapshot.decisions ?? [];

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/operations/${snapshot.operation.id}`, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json();
        setSnapshot(body.data);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [snapshot.operation.id]);

  useEffect(() => {
    let cancelled = false;
    async function refreshWhatsApp() {
      const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
      if (!cancelled && response.ok) {
        const body = await response.json();
        setWhatsApp(body.data);
      }
    }
    void refreshWhatsApp();
    const timer = window.setInterval(refreshWhatsApp, whatsapp?.paired ? 15_000 : 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [whatsapp?.paired]);

  async function repairWhatsApp() {
    const response = await fetch("/api/whatsapp/status", { method: "POST" });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "WhatsApp pairing failed");
    else setWhatsApp(body.data);
  }

  async function run(action: Action, method = "POST", payload?: unknown) {
    setBusy(action);
    setError("");
    const suffix = action === "save" ? "" : `/${action}`;
    const response = await fetch(`/api/operations/${snapshot.operation.id}${suffix}`, {
      method: action === "save" ? "PATCH" : method,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Action failed");
    else {
      setSnapshot(body.data);
      if (action === "save") setEditing(false);
    }
    setBusy(null);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function playEvidence() {
    const audio = evidenceAudio.current;
    if (!audio || !snapshot.evidence) return;
    audio.currentTime = snapshot.evidence.startSeconds;
    void audio.play();
  }

  return (
    <main className="control-room">
      <header className="topbar">
        <div className="brand-lockup compact">
          <span className="brand-mark">V</span>
          <span>VOLTA / OPS</span>
        </div>
        <div className="topbar-operation">
          <span className="micro-label">Active operation</span>
          <strong>{snapshot.operation.reference}</strong>
          <span className="topbar-divider" />
          <span>{snapshot.operation.containerReference}</span>
        </div>
        <div className="topbar-actions">
          <span className="environment-tag">
            <Radio size={12} /> LIVE CONTROL
          </span>
          <button className="icon-button" title="Sign out" onClick={logout}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <section className="route-ribbon">
        <div>
          <span className="route-index">01</span>
          <span>{snapshot.operation.pickupLocation}</span>
        </div>
        <div className="route-line"><ArrowRight size={17} /></div>
        <div>
          <span className="route-index">02</span>
          <span>{snapshot.operation.deliveryLocation}</span>
        </div>
        <div className="route-status">
          <StatusPill status={snapshot.operation.status} />
        </div>
      </section>

      {error ? (
        <div className="error-banner"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>
      ) : null}

      {whatsapp?.configured ? (
        <section className={`whatsapp-connection ${whatsapp.paired ? "connected" : "pairing"}`}>
          <div className="whatsapp-connection-copy">
            <span className="whatsapp-icon"><QrCode size={20} /></span>
            <div>
              <span className="micro-label">WhatsApp voice transport</span>
              <strong>{whatsapp.paired ? "Connected and ready for AI calls" : "Scan to connect Volta"}</strong>
              <small>{whatsapp.paired ? "Audio routes through WaCalls to GPT-Realtime-2.1" : "WhatsApp → Linked devices → Link a device"}</small>
            </div>
          </div>
          {!whatsapp.paired && whatsapp.qrDataUrl ? <Image src={whatsapp.qrDataUrl} width={180} height={180} unoptimized alt="WhatsApp pairing QR code" /> : null}
          {!whatsapp.paired && !whatsapp.qrDataUrl ? <button className="secondary-button" onClick={repairWhatsApp}><QrCode size={15} />Generate QR</button> : <StatusPill status={whatsapp.paired ? "CONNECTED" : "RINGING"} label={whatsapp.paired ? "WHATSAPP READY" : whatsapp.state.toUpperCase()} />}
        </section>
      ) : null}

      <div className="dashboard-grid">
        <aside className="mandate-panel">
          <div className="section-heading">
            <div><span className="section-number">A</span><h2>Human mandate</h2></div>
            <button className="text-button" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</button>
          </div>
          <div className="mandate-lock"><ShieldCheck size={19} /><div><strong>System authority</strong><span>Phone claims cannot expand it</span></div></div>

          <div className="field-grid">
            <label><span>Pickup day</span><input type="date" disabled={!editing} value={form.pickupDate} onChange={(e) => setForm({ ...form, pickupDate: e.target.value })} /></label>
            <label><span>Window from</span><input type="time" disabled={!editing} value={form.pickupWindowStart} onChange={(e) => setForm({ ...form, pickupWindowStart: e.target.value })} /></label>
            <label><span>Window to</span><input type="time" disabled={!editing} value={form.pickupWindowEnd} onChange={(e) => setForm({ ...form, pickupWindowEnd: e.target.value })} /></label>
          </div>
          <div className="rate-block">
            <label><span>Target rate</span><div className="money-input"><small>MXN</small><input type="number" disabled={!editing} value={form.targetRate} onChange={(e) => setForm({ ...form, targetRate: Number(e.target.value) })} /></div></label>
            <ArrowDownRight size={18} />
            <label><span>Hard ceiling</span><div className="money-input limit"><small>MXN</small><input type="number" disabled={!editing} value={form.maximumRate} onChange={(e) => setForm({ ...form, maximumRate: Number(e.target.value) })} /></div></label>
          </div>
          <div className="permission-list">
            <div><Check size={14} /><span>Negotiate rate</span><strong>YES</strong></div>
            <div><X size={14} /><span>Change pickup day</span><strong>NO</strong></div>
            <div><X size={14} /><span>Accept accessorials</span><strong>NO</strong></div>
            <div><Zap size={14} /><span>Counter offers</span><strong>{snapshot.mandate.maximumCounters} MAX</strong></div>
          </div>

          <div className="carrier-config">
            <span className="micro-label">Consented test phones</span>
            {snapshot.carriers.map((carrier) => (
              <label key={carrier.id}><span>{carrier.name}</span><input disabled={!editing} value={form.carrierPhones[carrier.id]} onChange={(e) => setForm({ ...form, carrierPhones: { ...form.carrierPhones, [carrier.id]: e.target.value } })} /></label>
            ))}
          </div>
          {editing ? <button className="secondary-button full-button" onClick={() => run("save", "PATCH", form)} disabled={busy === "save"}><Save size={15} />{busy === "save" ? "Saving…" : "Save mandate"}</button> : null}
        </aside>

        <section className="main-stage">
          <div className="outcome-header">
            <div>
              <p className="eyebrow">Operational outcome</p>
              {snapshot.commitment?.status === "COMMITTED" && winningOffer ? (
                <>
                  <h1>{winningCarrier?.name} booked</h1>
                  <p className="outcome-value">{money.format(winningOffer.amount)} <span>/ {winningOffer.pickupDate} · {winningOffer.pickupTime}</span></p>
                </>
              ) : (
                <>
                  <h1>{hasQuoteCalls ? "Market in motion" : "Ready to delegate"}</h1>
                  <p className="outcome-value muted">{hasQuoteCalls ? `${latestOffers(snapshot.offers).length} of 3 offers received` : "3 carriers · 1 human mandate"}</p>
                </>
              )}
            </div>
            <div className="outcome-actions">
              <button className="secondary-button" onClick={() => run("reset")} disabled={busy !== null}><RefreshCw size={15} />Reset demo</button>
              {snapshot.commitment?.status === "COMMITTED" && !snapshot.escalation ? (
                <button className="secondary-button" onClick={() => run("simulate-inbound")} disabled={busy !== null}><AlertTriangle size={15} />Inbound exception</button>
              ) : null}
              {!hasQuoteCalls ? (
                <button className="primary-button" data-testid="start-scan" onClick={() => run("scan")} disabled={busy !== null}><PhoneCall size={17} />{busy === "scan" ? "Starting calls…" : "Start market scan"}</button>
              ) : winningOffer && !snapshot.commitment ? (
                <button className="primary-button" data-testid="book-winner" onClick={() => run("book")} disabled={busy !== null}><CheckCircle2 size={17} />{busy === "book" ? "Calling winner…" : "Book winner"}</button>
              ) : null}
            </div>
          </div>

          <div className="carrier-lane">
            {snapshot.carriers.map((carrier, index) => {
              const call = carrierCall(snapshot, carrier.id);
              const offer = currentOffer(snapshot, carrier.id);
              const isWinner = winningOffer?.carrierId === carrier.id;
              return (
                <article className={`carrier-card ${isWinner ? "winner" : ""}`} key={carrier.id}>
                  <div className="carrier-card-head"><span className="carrier-number">0{index + 1}</span>{call ? <StatusPill status={call.status} /> : <StatusPill status="READY" />}</div>
                  <div><h3>{carrier.name}</h3><p>{carrier.dispatcher}</p></div>
                  {offer ? (
                    <div className="carrier-offer"><strong>{money.format(offer.amount)}</strong><span>{offer.pickupDate} · {offer.pickupTime}</span>{offer.eligible ? <small className="eligible"><ShieldCheck size={12} />Within mandate</small> : <small className="blocked"><AlertTriangle size={12} />{offer.violations[0]?.replaceAll("_", " ")}</small>}</div>
                  ) : (
                    <div className="carrier-empty"><Phone size={16} /><span>{call ? "Awaiting structured offer" : "Not contacted"}</span></div>
                  )}
                  {isWinner ? <div className="winner-ribbon"><Sparkles size={12} />BEST ELIGIBLE</div> : null}
                </article>
              );
            })}
          </div>

          <section className="market-panel">
            <div className="section-heading"><div><span className="section-number">B</span><h2>Market comparison</h2></div><span className="micro-label">Policy-ranked, not LLM-ranked</span></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Rank</th><th>Carrier</th><th>Final offer</th><th>Pickup</th><th>Mandate</th><th>Decision</th></tr></thead>
                <tbody>
                  {latestOffers(snapshot.offers).length ? [...latestOffers(snapshot.offers)].sort((a, b) => a.amount - b.amount).map((offer) => {
                    const carrier = snapshot.carriers.find((item) => item.id === offer.carrierId);
                    const rank = ranked.findIndex((item) => item.id === offer.id) + 1;
                    return <tr key={offer.id} className={winningOffer?.id === offer.id ? "winner-row" : ""}><td>{offer.eligible ? `#${rank}` : "—"}</td><td><strong>{carrier?.name}</strong><span>rev. {offer.revision}</span></td><td>{money.format(offer.amount)}</td><td>{offer.pickupDate}<span>{offer.pickupTime}</span></td><td><StatusPill status={offer.eligible ? "COMPLETED" : "FAILED"} label={offer.eligible ? "ELIGIBLE" : "BLOCKED"} /></td><td>{winningOffer?.id === offer.id ? "SELECT" : offer.eligible ? "HOLD" : offer.violations[0]?.replaceAll("_", " ")}</td></tr>;
                  }) : <tr><td colSpan={6} className="empty-table">No structured offers yet. Start the market scan.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="intelligence-grid">
            <article className="transcript-panel" data-testid="conversation-transcript">
              <div className="section-heading"><div><span className="section-number">C</span><h2>Conversation transcript</h2></div><span className="micro-label">Final turns · Realtime ASR</span></div>
              {transcripts.length ? (
                <div className="transcript-stream">
                  {transcripts.slice(-18).map((segment) => {
                    const call = snapshot.calls.find((item) => item.id === segment.callId);
                    const carrier = snapshot.carriers.find((item) => item.id === call?.carrierId);
                    return (
                      <article className={`transcript-turn ${segment.speaker.toLowerCase()}`} key={segment.id}>
                        <div><strong>{segment.speaker === "AGENT" ? "VOLTA" : carrier?.dispatcher ?? "COUNTERPARTY"}</strong><span>{call?.mode ?? "CALL"} · {shortTime.format(new Date(segment.occurredAt))}</span></div>
                        <p>{segment.text}</p>
                      </article>
                    );
                  })}
                </div>
              ) : <div className="blank-state intelligence-blank"><AudioLines size={22} /><div><strong>No final transcript yet</strong><span>Agent and counterparty turns will appear here as Realtime finalizes them.</span></div></div>}
            </article>

            <article className="decision-panel" data-testid="decision-trace">
              <div className="section-heading"><div><span className="section-number">D</span><h2>Authority decisions</h2></div><span className="micro-label">Server evaluated</span></div>
              {decisions.length ? (
                <div className="decision-stream">
                  {decisions.slice(0, 12).map((decision) => (
                    <article className="decision-card" key={decision.id}>
                      <div><StatusPill status={decision.outcome} /><span className="decision-source">{decision.source.replaceAll("_", " ")}</span></div>
                      <strong>{decision.kind.replaceAll("_", " ")}</strong>
                      <p>{decision.rationale}</p>
                      <div className="reason-codes">{decision.reasonCodes.map((reason) => <span key={reason}>{reason.replaceAll("_", " ")}</span>)}</div>
                    </article>
                  ))}
                </div>
              ) : <div className="blank-state intelligence-blank"><ShieldCheck size={22} /><div><strong>No policy decision yet</strong><span>Offers and changes are decided by mandate rules, never by the transcript alone.</span></div></div>}
            </article>
          </section>

          <section className="verification-grid">
            <article className="commitment-panel">
              <div className="section-heading"><div><span className="section-number">E</span><h2>Commitment ledger</h2></div>{snapshot.commitment ? <StatusPill status={snapshot.commitment.status} /> : null}</div>
              {snapshot.commitment ? (
                <>
                  <div className="commitment-outcome"><ShieldCheck size={23} /><div><span>Verified outcome</span><strong>{snapshot.commitment.status === "COMMITTED" ? `${winningCarrier?.name} · ${money.format(winningOffer?.amount ?? 0)}` : "Verification in progress"}</strong></div></div>
                  <p className="recap-text">{snapshot.commitment.recapText}</p>
                  <div className="verification-steps">
                    {["VERBALLY CONFIRMED", "RECAP SENT", "EVIDENCE LINKED", "COMMITTED"].map((step, index) => {
                      const levels = ["VERBALLY_CONFIRMED", "RECAP_SENT", "EVIDENCE_LINKED", "COMMITTED"];
                      const current = levels.indexOf(snapshot.commitment!.status);
                      const done = current >= index || snapshot.commitment!.status === "COMMITTED";
                      return <div className={done ? "done" : ""} key={step}><span>{done ? <Check size={12} /> : index + 1}</span><small>{step}</small></div>;
                    })}
                  </div>
                </>
              ) : <div className="blank-state"><CircleDot size={22} /><div><strong>No commitment yet</strong><span>A quote becomes a commitment only after explicit confirmation, written recap and linked evidence.</span></div></div>}
            </article>

            <article className="evidence-panel">
              <div className="section-heading"><div><span className="section-number">F</span><h2>Audio evidence</h2></div><AudioLines size={18} /></div>
              {snapshot.evidence ? (
                <>
                  <button className="audio-proof" onClick={playEvidence}><span className="play-orb"><Play size={18} fill="currentColor" /></span><span className="waveform" aria-hidden="true">{Array.from({ length: 34 }).map((_, index) => <i key={index} style={{ height: `${8 + ((index * 17) % 29)}px` }} />)}</span><span className="audio-time">{snapshot.evidence.startSeconds.toFixed(2)}s</span></button>
                  <audio ref={evidenceAudio} src={snapshot.evidence.recordingUrl} preload="metadata" />
                  <blockquote>“{snapshot.evidence.segmentText}”</blockquote>
                  <div className="evidence-meta"><span><Headphones size={13} />{snapshot.evidence.speaker}</span><span><Clock3 size={13} />{snapshot.evidence.startSeconds.toFixed(2)}–{snapshot.evidence.endSeconds.toFixed(2)}s</span></div>
                </>
              ) : <div className="blank-state compact-blank"><AudioLines size={22} /><div><strong>Evidence pending</strong><span>The commitment cannot reach verified state without an audio segment.</span></div></div>}
            </article>
          </section>
        </section>

        <aside className="ledger-panel">
          <div className="section-heading"><div><span className="section-number">G</span><h2>Audit stream</h2></div><Activity size={17} /></div>
          <div className="ledger-list">
            {snapshot.events.map((event) => <LedgerItem key={event.id} severity={event.severity} summary={event.summary} type={event.type} time={event.occurredAt} />)}
          </div>
          <div className="ledger-footer"><span className="pulse-dot" />AUTO-REFRESH · 2 SEC</div>
        </aside>
      </div>

      {snapshot.escalation && snapshot.escalation.status !== "RESOLVED" ? (
        <aside className="escalation-drawer">
          <div className="escalation-stripe" />
          <div className="escalation-head"><div><span className="live-badge"><span />LIVE ESCALATION</span><h2>Authority boundary reached</h2></div><StatusPill status={snapshot.escalation.status} /></div>
          <dl><div><dt>Operation</dt><dd>{snapshot.operation.customer} / {snapshot.operation.containerReference}</dd></div><div><dt>Current issue</dt><dd>{snapshot.escalation.reason}</dd></div><div><dt>Requested change</dt><dd>{snapshot.escalation.requestedChange}</dd></div><div><dt>Mandate conflict</dt><dd>Agent is not authorized to change the agreed terms.</dd></div></dl>
          <button className="takeover-button" onClick={() => run("takeover")} disabled={busy === "takeover" || snapshot.escalation.status === "CONNECTED"}><PhoneCall size={18} />{snapshot.escalation.status === "CONNECTED" ? "HUMAN CONNECTED" : busy === "takeover" ? "DIALING OPERATOR…" : "TAKE OVER CALL"}</button>
        </aside>
      ) : null}
    </main>
  );
}

function LedgerItem({ severity, summary, type, time }: { severity: Severity; summary: string; type: string; time: string }) {
  return <article className={`ledger-item ${severity.toLowerCase()}`}><div className="ledger-marker" /><div><div className="ledger-item-head"><span>{type.replaceAll(".", " / ")}</span><time>{shortTime.format(new Date(time))}</time></div><p>{summary}</p></div></article>;
}
