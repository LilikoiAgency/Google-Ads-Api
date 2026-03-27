"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../../globals.css";


const EMPTY_FORM = {
  name: "", slug: "", logo: "",
  adAccounts: { google: [], bing: [], meta: [] },
  audienceLabSegments: [],
  active: true,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function slugify(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── platform badge ────────────────────────────────────────────────────────────

const PLATFORM_COLORS = {
  google: "bg-blue-100 text-blue-700",
  bing:   "bg-sky-100 text-sky-700",
  meta:   "bg-indigo-100 text-indigo-700",
};
const PLATFORM_LABELS = { google: "Google Ads", bing: "Bing Ads", meta: "Meta Ads" };

function PlatformBadge({ platform, count }) {
  if (!count) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${PLATFORM_COLORS[platform]}`}>
      {PLATFORM_LABELS[platform]} ×{count}
    </span>
  );
}

// ── account list editor (multi-account per platform) ─────────────────────────

function AccountListEditor({ platform, accounts, availableAccounts, loadingAccounts, onChange }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const added    = new Set(accounts.map((a) => a.accountId));
  const filtered = availableAccounts.filter(
    (a) => !added.has(a.accountId) && (a.name || "").toLowerCase().includes(search.toLowerCase())
  );

  const add    = (a) => { onChange([...accounts, { accountId: a.accountId, label: a.name, customerId: a.customerId }]); setOpen(false); setSearch(""); };
  const remove = (id) => onChange(accounts.filter((a) => a.accountId !== id));

  return (
    <div>
      {/* Added accounts */}
      <div className="flex flex-wrap gap-2 mb-2">
        {accounts.map((a) => (
          <span key={a.accountId} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            {a.label || a.accountId}
            <button onClick={() => remove(a.accountId)} className="text-gray-400 hover:text-red-500 transition ml-0.5">×</button>
          </span>
        ))}
      </div>

      {/* Dropdown */}
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-purple-400 hover:text-purple-600 transition">
          <span className="text-base leading-none">+</span>
          Add {PLATFORM_LABELS[platform]} account
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100">
              <input autoFocus type="text" placeholder="Search accounts…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-purple-400" />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {loadingAccounts ? (
                <p className="px-4 py-4 text-sm text-gray-400 text-center">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-400 text-center">No more accounts to add.</p>
              ) : filtered.map((a) => (
                <button key={a.accountId} type="button" onClick={() => add(a)}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{a.name}</p>
                    <p className="text-xs text-gray-400">ID: {a.accountId}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── segment multi-select ──────────────────────────────────────────────────────

function SegmentMultiSelect({ selected, segments, onChange }) {
  const toggle = (key) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else                        onChange([...selected, key]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {segments.length === 0 && <p className="text-xs text-gray-400">No segments configured in Audience Lab.</p>}
      {segments.map((s) => {
        const on = selected.includes(s.key);
        return (
          <button key={s.key} type="button" onClick={() => toggle(s.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
              on ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-400"
            }`}>
            {s.name}
            {on && <span className="ml-1">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── logo uploader ─────────────────────────────────────────────────────────────

function LogoUploader({ value, onChange }) {
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result); // base64 data URL
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex items-center gap-4">
      {value ? (
        <img src={value} alt="Logo" className="h-12 w-12 rounded-xl object-contain border border-gray-200 bg-white p-1" />
      ) : (
        <div className="h-12 w-12 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs">Logo</div>
      )}
      <label className="cursor-pointer rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-purple-400 hover:text-purple-600 transition">
        {value ? "Change logo" : "Upload logo"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </label>
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-xs text-red-400 hover:text-red-600">Remove</button>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function AdminClientsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const isAdminUser = status === "authenticated";

  const [clients,  setClients]   = useState([]);
  const [loading,  setLoading]   = useState(true);
  const [modal,    setModal]     = useState(null); // null | { mode: "add"|"edit", client? }
  const [form,     setForm]      = useState(EMPTY_FORM);
  const [saving,   setSaving]    = useState(false);
  const [saveErr,  setSaveErr]   = useState(null);
  const [copiedSlug, setCopiedSlug] = useState(null);

  // Available accounts for pickers
  const [googleAccounts, setGoogleAccounts] = useState([]);
  const [bingAccounts,   setBingAccounts]   = useState([]);
  const [metaAccounts,   setMetaAccounts]   = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Audience Lab segments
  const [allSegments, setAllSegments] = useState([]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/admin/clients");
  }, [status, isAdminUser, router]);

  const load = async () => {
    setLoading(true);
    try {
      const [clientsRes, segsRes] = await Promise.all([
        fetch("/api/admin/clients").then((r) => r.json()),
        fetch("/api/audience-lab/segments").then((r) => r.json()),
      ]);
      setClients(clientsRes.clients || []);
      const segs = (segsRes.slots || []).filter((s) => s.occupied).map((s) => s.segment);
      setAllSegments(segs);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { if (status === "authenticated" && isAdminUser) load(); }, [status, isAdminUser]);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const [g, b, m] = await Promise.all([
        fetch("/api/customers").then((r) => r.json()).catch(() => ({})),
        fetch("/api/bing-accounts").then((r) => r.json()).catch(() => ({})),
        fetch("/api/meta-accounts").then((r) => r.json()).catch(() => ({})),
      ]);
      setGoogleAccounts(
        (g.customers || g.accounts || []).map((a) => ({
          accountId:  String(a.id || a.accountId || a.customer_client?.id || ""),
          name:       a.descriptiveName || a.name || a.customer_client?.descriptive_name || `Account`,
          customerId: String(a.id || a.accountId || ""),
        }))
      );
      setBingAccounts(b.accounts || []);
      setMetaAccounts(m.accounts || []);
    } catch {}
    setAccountsLoading(false);
  };

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, adAccounts: { google: [], bing: [], meta: [] }, audienceLabSegments: [] });
    setSaveErr(null);
    setModal({ mode: "add" });
    loadAccounts();
  };

  const openEdit = (client) => {
    setForm({
      name: client.name, slug: client.slug, logo: client.logo || "",
      adAccounts: {
        google: client.adAccounts?.google || [],
        bing:   client.adAccounts?.bing   || [],
        meta:   client.adAccounts?.meta   || [],
      },
      audienceLabSegments: client.audienceLabSegments || [],
      active: client.active !== false,
    });
    setSaveErr(null);
    setModal({ mode: "edit", client });
    loadAccounts();
  };

  const closeModal = () => { setModal(null); setSaveErr(null); };

  const handleSave = async () => {
    setSaving(true); setSaveErr(null);
    try {
      const payload = {
        ...form,
        slug: form.slug || slugify(form.name),
      };
      const res  = modal.mode === "add"
        ? await fetch("/api/admin/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch(`/api/admin/clients?slug=${modal.client.slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      closeModal();
      await load();
    } catch (e) { setSaveErr(e.message); }
    setSaving(false);
  };

  const handleDelete = async (slug) => {
    if (!confirm(`Delete client "${slug}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/clients?slug=${slug}`, { method: "DELETE" });
    await load();
  };

  const handleRegenToken = async (slug) => {
    if (!confirm("Regenerate link? The old link will stop working immediately.")) return;
    const res  = await fetch(`/api/admin/clients?slug=${slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _action: "regenerateToken" }) });
    const json = await res.json();
    if (json.token) await load();
  };

  const copyLink = (client) => {
    const url = `${window.location.origin}/portal/${client.slug}?token=${client.accessToken}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(client.slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  if (status === "loading") return (
    <div className="flex min-h-screen items-center justify-center bg-customPurple-dark">
      <img src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif" alt="Loading" className="w-24 h-24" />
    </div>
  );


  return (
    <div className="min-h-screen bg-customPurple-dark">
      {/* Header */}
      <header className="border-b border-white/10 bg-customPurple-dark px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sm text-white hover:bg-white/20 transition">←</Link>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm text-xl">🏢</div>
            <div>
              <p className="text-lg font-semibold text-white">Client Portals</p>
              <p className="text-sm text-gray-400">{clients.length} client{clients.length !== 1 ? "s" : ""} configured</p>
            </div>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition px-4 py-2 text-sm font-semibold text-white">
            <span className="text-base leading-none">+</span> New Client
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="bg-gray-50 min-h-[calc(100vh-73px)]">
        <div className="mx-auto max-w-6xl px-6 py-8">

          {loading ? (
            <div className="grid gap-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
            </div>
          ) : clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-5xl mb-4">🏢</div>
              <p className="text-lg font-semibold text-gray-700 mb-1">No clients yet</p>
              <p className="text-sm text-gray-400 mb-6">Create your first client portal to get started.</p>
              <button onClick={openAdd} className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2.5 text-sm font-semibold text-white transition">
                + New Client
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {clients.map((client) => {
                const googleCount = client.adAccounts?.google?.length || 0;
                const bingCount   = client.adAccounts?.bing?.length   || 0;
                const metaCount   = client.adAccounts?.meta?.length   || 0;
                const segCount    = client.audienceLabSegments?.length || 0;

                return (
                  <div key={client.slug} className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
                    <div className="flex items-start gap-4">
                      {/* Logo */}
                      {client.logo ? (
                        <img src={client.logo} alt={client.name} className="h-12 w-12 rounded-xl object-contain border border-gray-100 bg-white p-1 flex-shrink-0" />
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-lg flex-shrink-0">
                          {(client.name || "?")[0].toUpperCase()}
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-semibold text-gray-900">{client.name}</p>
                          <span className="text-xs text-gray-400 font-mono">/{client.slug}</span>
                          {!client.active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Paused</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <PlatformBadge platform="google" count={googleCount} />
                          <PlatformBadge platform="bing"   count={bingCount}   />
                          <PlatformBadge platform="meta"   count={metaCount}   />
                          {segCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-xs font-semibold">
                              🎯 {segCount} segment{segCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400">Created {fmtDate(client.createdAt)}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        <button onClick={() => copyLink(client)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${copiedSlug === client.slug ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                          {copiedSlug === client.slug ? "✓ Copied!" : "Copy Link"}
                        </button>
                        <a href={`/portal/${client.slug}?token=${client.accessToken}`} target="_blank" rel="noopener noreferrer"
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition">
                          Preview ↗
                        </a>
                        <button onClick={() => openEdit(client)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition">
                          Edit
                        </button>
                        <button onClick={() => handleRegenToken(client.slug)}
                          className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 transition">
                          New Link
                        </button>
                        <button onClick={() => handleDelete(client.slug)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 transition">
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 flex-shrink-0">
              <h2 className="text-base font-bold text-gray-900">
                {modal.mode === "add" ? "New Client Portal" : `Edit — ${modal.client.name}`}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">

              {/* Logo */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Client Logo</p>
                <LogoUploader value={form.logo} onChange={(v) => setForm((f) => ({ ...f, logo: v }))} />
              </div>

              {/* Name + Slug */}
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Client Name *</span>
                  <input type="text" value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: modal.mode === "add" ? slugify(e.target.value) : f.slug }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-purple-400"
                    placeholder="CMK Construction, Inc." />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">URL Slug *</span>
                  <input type="text" value={form.slug}
                    onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:border-purple-400"
                    placeholder="cmk-construction"
                    disabled={modal.mode === "edit"} />
                  <p className="text-xs text-gray-400 mt-0.5">/portal/{form.slug || "…"}</p>
                </label>
              </div>

              {/* Google Ads Accounts */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Google Ads Accounts</p>
                <AccountListEditor
                  platform="google"
                  accounts={form.adAccounts.google}
                  availableAccounts={googleAccounts}
                  loadingAccounts={accountsLoading}
                  onChange={(accounts) => setForm((f) => ({ ...f, adAccounts: { ...f.adAccounts, google: accounts } }))}
                />
              </div>

              {/* Bing Accounts */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bing Ads Accounts</p>
                <AccountListEditor
                  platform="bing"
                  accounts={form.adAccounts.bing}
                  availableAccounts={bingAccounts}
                  loadingAccounts={accountsLoading}
                  onChange={(accounts) => setForm((f) => ({ ...f, adAccounts: { ...f.adAccounts, bing: accounts } }))}
                />
              </div>

              {/* Meta Accounts */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Meta Ads Accounts</p>
                <AccountListEditor
                  platform="meta"
                  accounts={form.adAccounts.meta}
                  availableAccounts={metaAccounts}
                  loadingAccounts={accountsLoading}
                  onChange={(accounts) => setForm((f) => ({ ...f, adAccounts: { ...f.adAccounts, meta: accounts } }))}
                />
              </div>

              {/* Audience Lab Segments */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Audience Lab Segments</p>
                <SegmentMultiSelect
                  selected={form.audienceLabSegments}
                  segments={allSegments}
                  onChange={(v) => setForm((f) => ({ ...f, audienceLabSegments: v }))}
                />
              </div>

              {/* Active toggle */}
              <label className="flex items-center gap-3 cursor-pointer" onClick={() => setForm((f) => ({ ...f, active: !f.active }))}>
                <div className={`relative w-10 h-6 rounded-full transition ${form.active ? "bg-purple-600" : "bg-gray-200"}`}>
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${form.active ? "left-5" : "left-1"}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">{form.active ? "Active" : "Paused"}</span>
              </label>

              {saveErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {saveErr}</p>}
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 flex-shrink-0">
              <button onClick={closeModal} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name}
                className="rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white transition">
                {saving ? "Saving…" : modal.mode === "add" ? "Create Portal" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
