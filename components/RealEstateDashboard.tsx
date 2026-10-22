'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  MessageSquare,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  getLiveActivities,
  getRealEstateOverview,
  addProperty,
  addBooking,
  type Property,
  type PropertyType,
  type Booking,
  type Broker,
  type LeadSource,
  type BookingStatus,
} from '@/lib/real-estate';

export function RealEstateDashboard() {
  const [overview, setOverview] = useState(getRealEstateOverview());
  // Leads, properties and brokers all come from the live Skyescraper
  // database, not the sample data in lib/real-estate.ts — each starts empty
  // and honest, filled once its fetch resolves.
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [leadsSource, setLeadsSource] = useState<'loading' | 'live' | 'none' | 'error'>('loading');
  const [leadsDetail, setLeadsDetail] = useState<string | null>(null);

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesSource, setPropertiesSource] = useState<'loading' | 'live' | 'none' | 'error'>('loading');

  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [brokersSource, setBrokersSource] = useState<'loading' | 'live' | 'none' | 'error'>('loading');

  const [activities, setActivities] = useState(getLiveActivities());

  const refreshLeads = useCallback(async () => {
    try {
      const res = await fetch('/api/real-estate/leads', { cache: 'no-store' });
      const body = (await res.json()) as { bookings: Booking[]; source: 'live' | 'none' | 'error'; detail?: string };
      setBookings(body.bookings);
      setLeadsSource(body.source);
      setLeadsDetail(body.detail ?? null);
    } catch (err) {
      setLeadsSource('error');
      setLeadsDetail(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshProperties = useCallback(async () => {
    try {
      const res = await fetch('/api/real-estate/properties', { cache: 'no-store' });
      const body = (await res.json()) as { properties: Property[]; source: 'live' | 'none' | 'error' };
      setProperties(body.properties);
      setPropertiesSource(body.source);
    } catch {
      setPropertiesSource('error');
    }
  }, []);

  const refreshBrokers = useCallback(async () => {
    try {
      const res = await fetch('/api/real-estate/brokers', { cache: 'no-store' });
      const body = (await res.json()) as { brokers: Broker[]; source: 'live' | 'none' | 'error' };
      setBrokers(body.brokers);
      setBrokersSource(body.source);
    } catch {
      setBrokersSource('error');
    }
  }, []);

  useEffect(() => {
    refreshLeads();
    refreshProperties();
    refreshBrokers();
  }, [refreshLeads, refreshProperties, refreshBrokers]);

  // Modals state
  const [showAddProp, setShowAddProp] = useState(false);
  const [showConfirmBooking, setShowConfirmBooking] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Form states
  const [newProp, setNewProp] = useState({
    name: '',
    loc: '',
    price: '',
    bhk: '3 BHK',
    area: '',
    floor: '1st',
    type: 'Residential' as PropertyType,
    parking: '1 Covered',
    tags: 'Ready to Move, RERA Approved',
  });

  const [newBooking, setNewBooking] = useState({
    client: '',
    phone: '',
    property: '3BHK Kolar Road',
    budget: '₹72L',
    src: 'whatsapp' as LeadSource,
    broker: 'Rajesh Kumar',
    visit: 'Aug 12',
    status: 'confirmed' as BookingStatus,
  });

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProp.name || !newProp.loc) return;
    const created = addProperty({
      name: newProp.name,
      loc: newProp.loc,
      price: newProp.price || '₹50L',
      bhk: newProp.bhk,
      area: newProp.area || '1,200 sq.ft',
      floor: newProp.floor,
      status: 'available',
      type: newProp.type,
      parking: newProp.parking,
      tags: newProp.tags.split(',').map((t) => t.trim()),
    });
    // This manual form is a local sample action, not a write to Skyescraper
    // (real listings come from the Property Intelligence / Inventory agents)
    // — refresh from the real properties list rather than the sample store.
    void created;
    refreshProperties();
    setOverview(getRealEstateOverview());
    setActivities(getLiveActivities());
    setShowAddProp(false);
    triggerToast(`Added property ${created.name} to the local sample set (not written to Skyescraper)`);
  };

  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBooking.client) return;
    const created = addBooking({
      client: newBooking.client,
      phone: newBooking.phone || '+91 98000 00000',
      property: newBooking.property,
      budget: newBooking.budget,
      src: newBooking.src,
      broker: newBooking.broker,
      visit: newBooking.visit,
      status: newBooking.status,
    });
    // This manual form is a local sample action, not a write to Skyescraper
    // (that happens through the Lead Management Agent chat below) — refresh
    // from the real leads list rather than the sample store, so the table
    // never shows a booking that doesn't actually exist in Skyescraper.
    void created;
    refreshLeads();
    setOverview(getRealEstateOverview());
    setActivities(getLiveActivities());
    setShowConfirmBooking(false);
    triggerToast(`Booking ${created.id} added to the local sample set (not written to Skyescraper)`);
  };

  const sourceBadge = (s: LeadSource) => {
    switch (s) {
      case 'whatsapp':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(63,217,104,0.12)] px-2 py-0.5 text-[11px] font-medium text-[var(--ok)]">
            <MessageSquare className="h-3 w-3" /> WhatsApp
          </span>
        );
      case 'meta':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(110,150,242,0.12)] px-2 py-0.5 text-[11px] font-medium text-[var(--ramp-1)]">
            <TrendingUp className="h-3 w-3" /> Meta Ads
          </span>
        );
      case 'voice':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(189,95,232,0.12)] px-2 py-0.5 text-[11px] font-medium text-[var(--ramp-4)]">
            <PhoneCall className="h-3 w-3" /> Voice Call
          </span>
        );
    }
  };

  const statusBadge = (st: BookingStatus) => {
    switch (st) {
      case 'confirmed':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(63,217,104,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ok)]">
            Confirmed
          </span>
        );
      case 'site_visit':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(110,150,242,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ramp-1)]">
            Site Visit
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(242,179,61,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--warn)]">
            Pending
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[rgba(240,78,82,0.15)] px-2 py-0.5 text-[11px] font-semibold text-[var(--err)]">
            Cancelled
          </span>
        );
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-52px)] w-full space-y-6 pb-12 pt-2 text-[var(--text)]">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-3 text-sm shadow-xl">
          <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Operations Header */}
      <div className="flex flex-col gap-4 border-b border-[var(--border)] pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text)]">Prime Realty — Operations Hub</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(63,217,104,0.3)] bg-[rgba(63,217,104,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ok)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)] animate-pulse" />
              LangGraph Live · All Agents Online
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-2)]">
            Real Estate Command Center — Lead Intake, AI Qualification, Site Visits & Telegram Broker Dispatch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setOverview(getRealEstateOverview());
              refreshProperties();
              refreshLeads();
              refreshBrokers();
              setActivities(getLiveActivities());
              triggerToast('Refreshed real-time operations feed');
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddProp(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Property
          </button>
          <button
            onClick={() => setShowConfirmBooking(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-ink)] transition hover:opacity-90"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirm Booking
          </button>
        </div>
      </div>

      {/* Top 4 Real Estate KPI Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
            <span>Total Inbound Leads</span>
            <span className="text-[11px] font-medium text-[var(--ok)]">↑ {overview.leadsDeltaPct}% vs July</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--text)]">{overview.totalLeads}</span>
            <span className="text-xs text-[var(--text-3)]">leads</span>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-3)]">Meta Ads, WhatsApp & Direct Calls</div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
            <span>Bookings Confirmed</span>
            <span className="text-[11px] font-medium text-[var(--ok)]">↑ {overview.bookingsDeltaPct}%</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--text)]">{overview.confirmedBookings}</span>
            <span className="text-xs text-[var(--text-3)]">closed/site visits</span>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-3)]">27% lead-to-booking conversion</div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
            <span>Active Inventory</span>
            <span className="text-[11px] font-medium text-[var(--ramp-1)]">24 total listings</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--text)]">{overview.activeProperties}</span>
            <span className="text-xs text-[var(--text-3)]">available</span>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-3)]">Residential, Commercial & Plots</div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]">
          <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
            <span>Revenue Pipeline</span>
            <span className="text-[11px] font-medium text-[var(--ok)]">↑ {overview.pipelineDeltaPct}%</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-[var(--accent)]">{overview.pipelineValue}</span>
            <span className="text-xs text-[var(--text-3)]">deal volume</span>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-3)]">Active negotiations across Bhopal</div>
        </div>
      </div>

      {/* Main Operations Split: Funnel & Sources + AI Agents */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Lead Funnel & Channels (8 cols) */}
        <div className="space-y-6 lg:col-span-8">
          {/* Real Estate Conversion Funnel */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Lead Qualification Funnel</h2>
                <p className="text-xs text-[var(--text-2)]">Automated qualification stages from intake to confirmed site visit</p>
              </div>
              <span className="rounded bg-[var(--surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-2)]">
                August 2026
              </span>
            </div>

            <div className="mt-4 space-y-3.5">
              {overview.funnelStages.map((st) => (
                <div key={st.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text)]">{st.label}</span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[var(--text)]">{st.count}</span>
                      <span className="text-[11px] text-[var(--text-3)]">({st.pct}%)</span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${st.pct}%`,
                        backgroundColor:
                          st.id === 'confirmed'
                            ? 'var(--ok)'
                            : st.id === 'visit'
                            ? 'var(--accent)'
                            : 'var(--ramp-1)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Lead Sources Grid */}
            <div className="mt-6 border-t border-[var(--hairline)] pt-4">
              <div className="text-xs font-medium text-[var(--text-2)] mb-3">Lead Inbound Channels</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {overview.sources.map((src) => (
                  <div key={src.source} className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-3">
                    <div className="flex items-center justify-between text-xs text-[var(--text-2)]">
                      <span>{src.label}</span>
                      <span className="font-mono text-[11px] font-bold text-[var(--text)]">{src.pct}%</span>
                    </div>
                    <div className="mt-2 text-lg font-bold text-[var(--text)]">{src.count} <span className="text-xs font-normal text-[var(--text-3)]">leads</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Bookings & Telegram Broker Dispatch */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text)]">Real Leads &mdash; Skyescraper</h2>
                <p className="text-xs text-[var(--text-2)]">
                  {leadsSource === 'loading' && 'Loading leads from Skyescraper…'}
                  {leadsSource === 'live' && `Live — ${bookings.length} lead${bookings.length === 1 ? '' : 's'} from the real database`}
                  {leadsSource === 'none' && (leadsDetail ?? 'Not configured — set SKYESCRAPER_API_TOKEN')}
                  {leadsSource === 'error' && `Could not reach Skyescraper: ${leadsDetail ?? 'unknown error'}`}
                </p>
              </div>
              <button
                onClick={() => setShowConfirmBooking(true)}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                + Sample Booking
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-3)] font-medium">
                    <th className="pb-2">Lead ID</th>
                    <th className="pb-2">Client</th>
                    <th className="pb-2">Property</th>
                    <th className="pb-2">Budget</th>
                    <th className="pb-2">Channel</th>
                    <th className="pb-2">Assigned Agent</th>
                    <th className="pb-2">Stage</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--hairline)]">
                  {bookings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-[var(--text-3)]">
                        {leadsSource === 'loading' ? 'Loading…' : 'No leads to show.'}
                      </td>
                    </tr>
                  )}
                  {bookings.slice(0, 7).map((b) => (
                    <tr key={b.id} className="transition hover:bg-[var(--surface-2)]">
                      <td className="py-2.5 font-mono text-[var(--text-3)]">{b.id}</td>
                      <td className="py-2.5 font-medium text-[var(--text)]">{b.client}</td>
                      <td className="py-2.5 text-[var(--text-2)] max-w-[150px] truncate">{b.property}</td>
                      <td className="py-2.5 font-mono font-semibold text-[var(--accent)]">{b.budget}</td>
                      <td className="py-2.5">{sourceBadge(b.src)}</td>
                      <td className="py-2.5 font-medium text-[var(--text)]">{b.broker}</td>
                      <td className="py-2.5 text-[var(--text-2)]">{b.visit}</td>
                      <td className="py-2.5">{statusBadge(b.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: AI Agents & Live Operations Feed (4 cols) */}
        <div className="space-y-6 lg:col-span-4">
          {/* Active AI Agents Status */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Automation Fleet</h2>
              <Link href="/agents" className="text-xs text-[var(--accent)] hover:underline">
                View all →
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-[var(--ok)]" />
                    <span className="text-xs font-semibold text-[var(--text)]">Lead Management Agent</span>
                  </div>
                  <span className="rounded bg-[rgba(63,217,104,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
                    LangGraph
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--text-2)]">
                  Reads and acts on real Skyescraper leads via an in-process LangGraph agent.
                </div>
                <Link
                  href="/chats?agent=lead-management"
                  className="mt-2.5 flex items-center justify-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[11px] font-medium text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <MessageSquare className="h-3 w-3" /> Chat with it <ExternalLink className="h-3 w-3" />
                </Link>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-[var(--ramp-1)]" />
                    <span className="text-xs font-semibold text-[var(--text)]">Voice Call AI Agent</span>
                  </div>
                  <span className="rounded bg-[rgba(110,150,242,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ramp-1)]">
                    Online
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--text-2)]">
                  Direct call intake & Hindi/English voice booking. 8 calls transcribed today.
                </div>
              </div>

              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[var(--warn)]" />
                    <span className="text-xs font-semibold text-[var(--text)]">Follow-up Scheduler</span>
                  </div>
                  <span className="rounded bg-[rgba(242,179,61,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
                    Active
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--text-2)]">
                  Re-engages cold leads every 4 hours. 23 leads currently queued.
                </div>
              </div>
            </div>
          </div>

          {/* Active Field Brokers */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Field Agents &mdash; Skyescraper</h2>
              <span className="text-xs text-[var(--text-3)]">
                {brokersSource === 'loading' ? 'Loading…' : brokersSource === 'live' ? `${brokers.length} with leads` : 'Not configured'}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {brokers.length === 0 && brokersSource !== 'loading' && (
                <p className="text-[11px] text-[var(--text-3)]">No agents with assigned leads yet.</p>
              )}
              {brokers.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded border border-[var(--hairline)] p-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--text)]">{b.name}</div>
                    <div className="text-[11px] text-[var(--text-3)]">{b.spec}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-[var(--ok)]">{b.closed} closed</div>
                    <div className="text-[10px] text-[var(--text-3)]">of {b.leads} leads</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Operations Feed */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h2 className="text-sm font-semibold text-[var(--text)]">Live Operations Feed</h2>
              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ok)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" /> Live
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {activities.slice(0, 5).map((act) => (
                <div key={act.id} className="flex gap-2.5 text-xs">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                  <div className="space-y-0.5">
                    <div className="font-medium text-[var(--text)]">{act.title}</div>
                    <div className="text-[11px] text-[var(--text-2)]">{act.detail}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{act.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Property Inventory Preview Strip */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Active Properties & Listings &mdash; Skyescraper</h2>
            <p className="text-xs text-[var(--text-2)]">
              {propertiesSource === 'loading' && 'Loading real projects from Skyescraper…'}
              {propertiesSource === 'live' && `Live — ${properties.length} project${properties.length === 1 ? '' : 's'} from the real database`}
              {propertiesSource === 'none' && 'Not configured — set SKYESCRAPER_API_TOKEN'}
              {propertiesSource === 'error' && 'Could not reach Skyescraper'}
            </p>
          </div>
          <button onClick={() => setShowAddProp(true)} className="text-xs text-[var(--accent)] hover:underline">
            + Sample Property
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.length === 0 && (
            <p className="col-span-full py-6 text-center text-xs text-[var(--text-3)]">
              {propertiesSource === 'loading' ? 'Loading…' : 'No projects to show.'}
            </p>
          )}
          {properties.slice(0, 6).map((p) => (
            <div key={p.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4 transition hover:border-[var(--border-strong)]">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">{p.type}</span>
                  <h3 className="font-semibold text-sm text-[var(--text)]">{p.name}</h3>
                  <p className="text-xs text-[var(--text-2)] mt-0.5">{p.loc}</p>
                </div>
                <span className="rounded bg-[rgba(63,217,104,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
                  {p.status}
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between border-t border-[var(--hairline)] pt-3">
                <span className="font-mono text-base font-bold text-[var(--accent)]">{p.price}</span>
                <span className="text-xs text-[var(--text-3)]">{p.bhk} · {p.area}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {p.tags.map((t) => (
                  <span key={t} className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)] border border-[var(--hairline)]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL: ADD PROPERTY */}
      {showAddProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h3 className="text-base font-bold text-[var(--text)]">Add Real Estate Property</h3>
              <button onClick={() => setShowAddProp(false)} className="text-[var(--text-3)] hover:text-[var(--text)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddProperty} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-[var(--text-2)] mb-1">Property Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 3BHK Luxury Apartment"
                  value={newProp.name}
                  onChange={(e) => setNewProp({ ...newProp, name: e.target.value })}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Property Type</label>
                  <select
                    value={newProp.type}
                    onChange={(e) => setNewProp({ ...newProp, type: e.target.value as PropertyType })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="Residential">Residential</option>
                    <option value="Commercial">Commercial</option>
                    <option value="Plot">Plot</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Price Range *</label>
                  <input
                    type="text"
                    required
                    placeholder="₹65L – ₹75L"
                    value={newProp.price}
                    onChange={(e) => setNewProp({ ...newProp, price: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Location *</label>
                  <input
                    type="text"
                    required
                    placeholder="Kolar Road, Bhopal"
                    value={newProp.loc}
                    onChange={(e) => setNewProp({ ...newProp, loc: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">BHK / Config</label>
                  <input
                    type="text"
                    placeholder="3 BHK"
                    value={newProp.bhk}
                    onChange={(e) => setNewProp({ ...newProp, bhk: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-[var(--text-2)] mb-1">Tags (comma separated)</label>
                <input
                  type="text"
                  placeholder="Ready to Move, Gated Society, RERA Approved"
                  value={newProp.tags}
                  onChange={(e) => setNewProp({ ...newProp, tags: e.target.value })}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--hairline)] pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddProp(false)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent-ink)]"
                >
                  Add Property Listing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM BOOKING */}
      {showConfirmBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h3 className="text-base font-bold text-[var(--text)]">Confirm Site Visit & Assign Broker</h3>
              <button onClick={() => setShowConfirmBooking(false)} className="text-[var(--text-3)] hover:text-[var(--text)]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleConfirmBooking} className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Client Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Gupta"
                    value={newBooking.client}
                    onChange={(e) => setNewBooking({ ...newBooking, client: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+91 98765 43210"
                    value={newBooking.phone}
                    onChange={(e) => setNewBooking({ ...newBooking, phone: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Selected Property</label>
                  <input
                    type="text"
                    value={newBooking.property}
                    onChange={(e) => setNewBooking({ ...newBooking, property: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Client Budget</label>
                  <input
                    type="text"
                    placeholder="₹72L"
                    value={newBooking.budget}
                    onChange={(e) => setNewBooking({ ...newBooking, budget: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Inbound Channel</label>
                  <select
                    value={newBooking.src}
                    onChange={(e) => setNewBooking({ ...newBooking, src: e.target.value as LeadSource })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="whatsapp">WhatsApp Direct</option>
                    <option value="meta">Meta Ads</option>
                    <option value="voice">Voice Call</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Assign Field Broker (Telegram)</label>
                  <select
                    value={newBooking.broker}
                    onChange={(e) => setNewBooking({ ...newBooking, broker: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    {brokers.map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name} ({b.spec})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Site Visit Date</label>
                  <input
                    type="text"
                    placeholder="e.g. Sunday Aug 10, 11 AM"
                    value={newBooking.visit}
                    onChange={(e) => setNewBooking({ ...newBooking, visit: e.target.value })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[var(--text-2)] mb-1">Status</label>
                  <select
                    value={newBooking.status}
                    onChange={(e) => setNewBooking({ ...newBooking, status: e.target.value as BookingStatus })}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="site_visit">Site Visit Scheduled</option>
                    <option value="pending">Pending Qualification</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-[var(--hairline)] pt-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmBooking(false)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-xs font-medium text-[var(--text)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent-ink)]"
                >
                  Confirm & Dispatch to Telegram
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
