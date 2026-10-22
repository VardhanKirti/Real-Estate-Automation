/**
 * Real Estate Operations Data Layer & Services
 *
 * Provides typed data models, store access, and operations for:
 * - Property Inventory (Residential, Commercial, Plots)
 * - Lead Funnel & Confirmed Bookings
 * - Field Broker Roster & Telegram dispatch tracking
 * - AI Voice & Chat Agent execution states
 * - Call Transcripts & Recordings
 * - Live Operations Feed
 */

export type PropertyStatus = 'available' | 'booked' | 'sold';
export type PropertyType = 'Residential' | 'Commercial' | 'Plot';

export interface Property {
  id: string;
  name: string;
  loc: string;
  price: string;
  bhk: string;
  area: string;
  floor: string;
  status: PropertyStatus;
  type: PropertyType;
  parking: string;
  tags: string[];
}

export type BookingStatus = 'confirmed' | 'pending' | 'site_visit' | 'cancelled';
export type LeadSource = 'whatsapp' | 'meta' | 'voice';

export interface Booking {
  id: string;
  client: string;
  phone?: string;
  property: string;
  budget: string;
  src: LeadSource;
  broker: string;
  visit: string;
  status: BookingStatus;
  createdAt?: string;
}

export interface Broker {
  id: string;
  name: string;
  init: string;
  color: string;
  spec: string;
  phone: string;
  tg: string;
  exp: string;
  leads: number;
  closed: number;
  rev: string;
  rating: string;
  status: 'active' | 'busy' | 'away';
}

export interface BrokerLogEntry {
  id: string;
  date: string;
  client: string;
  prop: string;
  broker: string;
  tg: string;
  status: BookingStatus;
  comm: string;
}

export interface RealEstateAgentState {
  id: string;
  name: string;
  role: string;
  runtime: string;
  status: 'online' | 'running' | 'idle' | 'error';
  desc: string;
  metrics: { k: string; v: string }[];
}

export interface CallRecording {
  id: string;
  caller: string;
  phone: string;
  color: string;
  init: string;
  date: string;
  time: string;
  dur: string;
  outcome: 'booking' | 'followup' | 'declined';
  prop: string;
  waves: number[];
  transcript: { ai: boolean; spk: string; txt: string }[];
}

export interface LiveActivity {
  id: string;
  type: 'booking' | 'whatsapp' | 'call' | 'visit' | 'followup' | 'property';
  title: string;
  detail: string;
  time: string;
  source?: string;
}

// ── In-Memory Store with Default Real Estate Data ──────────

let PROPERTIES: Property[] = [
  { id: 'PR-001', name: '3BHK Luxury Apartment', loc: 'Kolar Road, Bhopal', price: '₹65L – ₹75L', bhk: '3 BHK', area: '1,450 sq.ft', floor: '5th', status: 'available', type: 'Residential', parking: '2 Covered', tags: ['Ready to Move', 'Gated Society', 'RERA Approved'] },
  { id: 'PR-002', name: '2BHK Modern Flat', loc: 'Habibganj, Bhopal', price: '₹42L – ₹48L', bhk: '2 BHK', area: '1,050 sq.ft', floor: '3rd', status: 'available', type: 'Residential', parking: '1 Covered', tags: ['Dec 2025 Possession', 'RERA Approved'] },
  { id: 'PR-003', name: '4BHK Premium Villa', loc: 'Chinar Park, Bhopal', price: '₹1.2Cr – ₹1.5Cr', bhk: '4 BHK', area: '3,200 sq.ft', floor: 'G+1', status: 'booked', type: 'Residential', parking: '3 Covered', tags: ['Private Pool', 'Smart Home', 'Luxury'] },
  { id: 'PR-004', name: 'Commercial Shop Space', loc: 'DB Mall Road, Bhopal', price: '₹25L – ₹35L', bhk: 'Shop', area: '450 sq.ft', floor: 'Ground', status: 'available', type: 'Commercial', parking: 'Common', tags: ['Main Road', 'High Footfall'] },
  { id: 'PR-005', name: 'Plot 200 sq.yd', loc: 'Misrod, Bhopal', price: '₹18L – ₹22L', bhk: 'Plot', area: '200 sq.yd', floor: 'NA', status: 'available', type: 'Plot', parking: 'NA', tags: ['RERA Approved', 'Corner Plot'] },
  { id: 'PR-006', name: '3BHK Builder Floor', loc: 'Arera Colony, Bhopal', price: '₹55L – ₹62L', bhk: '3 BHK', area: '1,300 sq.ft', floor: '2nd', status: 'sold', type: 'Residential', parking: '1 Covered', tags: ['Sold Out'] },
  { id: 'PR-007', name: '2BHK Studio Apartment', loc: 'MP Nagar, Bhopal', price: '₹35L – ₹42L', bhk: '2 BHK', area: '890 sq.ft', floor: '7th', status: 'available', type: 'Residential', parking: '1 Covered', tags: ['High Rise', 'Metro Nearby'] },
  { id: 'PR-008', name: 'Office Space 1000 sqft', loc: 'Hoshangabad Road', price: '₹55L – ₹65L', bhk: 'Office', area: '1,000 sq.ft', floor: '4th', status: 'available', type: 'Commercial', parking: '5 Open', tags: ['Corporate Zone', 'RERA Approved'] },
  { id: 'PR-009', name: 'Agricultural Land 2 Acre', loc: 'Ratibad, Bhopal', price: '₹30L – ₹38L', bhk: 'Land', area: '2 Acres', floor: 'NA', status: 'available', type: 'Plot', parking: 'NA', tags: ['Investment Zone', 'Highway Access'] },
];

let BOOKINGS: Booking[] = [
  { id: 'BK-1042', client: 'Ramesh Gupta', phone: '+91 98765 43210', property: '3BHK Kolar Road', budget: '₹72L', src: 'whatsapp', broker: 'Rajesh Kumar', visit: 'Aug 8', status: 'confirmed' },
  { id: 'BK-1041', client: 'Priya Sharma', phone: '+91 87654 32109', property: '2BHK Habibganj', budget: '₹45L', src: 'meta', broker: 'Meena Verma', visit: 'Aug 9', status: 'confirmed' },
  { id: 'BK-1040', client: 'Mohit Jain', phone: '+91 76543 21098', property: '4BHK Villa Chinar Park', budget: '₹1.3Cr', src: 'voice', broker: 'Sunil Sharma', visit: 'Aug 10', status: 'pending' },
  { id: 'BK-1039', client: 'Sunita Verma', phone: '+91 65432 10987', property: 'Commercial Shop DB Mall', budget: '₹28L', src: 'meta', broker: 'Sunil Sharma', visit: 'Aug 7', status: 'confirmed' },
  { id: 'BK-1038', client: 'Deepak Singh', phone: '+91 54321 09876', property: 'Plot 200sq.yd Misrod', budget: '₹20L', src: 'whatsapp', broker: 'Meena Verma', visit: 'Aug 6', status: 'site_visit' },
  { id: 'BK-1037', client: 'Kavita Rao', phone: '+91 43210 98765', property: '3BHK Kolar Road', budget: '₹68L', src: 'voice', broker: 'Rajesh Kumar', visit: 'Aug 5', status: 'confirmed' },
  { id: 'BK-1036', client: 'Aman Tiwari', phone: '+91 32109 87654', property: '2BHK Habibganj', budget: '₹43L', src: 'meta', broker: 'Meena Verma', visit: 'Aug 4', status: 'cancelled' },
  { id: 'BK-1035', client: 'Ritu Pandey', phone: '+91 98111 22334', property: '4BHK Villa Chinar Park', budget: '₹1.4Cr', src: 'whatsapp', broker: 'Rajesh Kumar', visit: 'Aug 3', status: 'confirmed' },
  { id: 'BK-1034', client: 'Vikas Malhotra', phone: '+91 98222 33445', property: 'Commercial Shop DB Mall', budget: '₹32L', src: 'meta', broker: 'Sunil Sharma', visit: 'Aug 2', status: 'confirmed' },
  { id: 'BK-1033', client: 'Neha Gupta', phone: '+91 98333 44556', property: 'Plot Misrod', budget: '₹19L', src: 'voice', broker: 'Meena Verma', visit: 'Aug 1', status: 'confirmed' },
];

let BROKERS: Broker[] = [
  { id: 'br-1', name: 'Rajesh Kumar', init: 'RK', color: '#1A6BFF', spec: 'Residential Specialist', phone: '+91 98001 11001', tg: '@rajesh_realty', exp: '8 Years', leads: 24, closed: 14, rev: '₹1.8Cr', rating: '4.8', status: 'active' },
  { id: 'br-2', name: 'Sunil Sharma', init: 'SS', color: '#12B76A', spec: 'Commercial Specialist', phone: '+91 98001 22002', tg: '@sunil_commercial', exp: '6 Years', leads: 18, closed: 10, rev: '₹95L', rating: '4.6', status: 'active' },
  { id: 'br-3', name: 'Meena Verma', init: 'MV', color: '#F79009', spec: 'Plots & Land Expert', phone: '+91 98001 33003', tg: '@meena_plots', exp: '5 Years', leads: 16, closed: 8, rev: '₹62L', rating: '4.5', status: 'active' },
];

let BROKER_LOG: BrokerLogEntry[] = [
  { id: 'bl-1', date: 'Aug 6', client: 'Ramesh Gupta', prop: '3BHK Kolar Road', broker: 'Rajesh Kumar', tg: 'Delivered', status: 'confirmed', comm: '₹72,000' },
  { id: 'bl-2', date: 'Aug 5', client: 'Priya Sharma', prop: '2BHK Habibganj', broker: 'Meena Verma', tg: 'Delivered', status: 'confirmed', comm: '₹45,000' },
  { id: 'bl-3', date: 'Aug 5', client: 'Sunita Verma', prop: 'Commercial Shop', broker: 'Sunil Sharma', tg: 'Delivered', status: 'confirmed', comm: '₹28,000' },
  { id: 'bl-4', date: 'Aug 4', client: 'Kavita Rao', prop: '3BHK Kolar Road', broker: 'Rajesh Kumar', tg: 'Delivered', status: 'confirmed', comm: '₹68,000' },
  { id: 'bl-5', date: 'Aug 3', client: 'Deepak Singh', prop: 'Plot Misrod', broker: 'Meena Verma', tg: 'Delivered', status: 'site_visit', comm: 'Pending' },
];

let ACTIVITIES: LiveActivity[] = [
  { id: 'act-1', type: 'booking', title: 'Booking confirmed', detail: 'Ramesh Gupta — 3BHK Kolar Road (Assigned to Rajesh Kumar)', time: '2m ago' },
  { id: 'act-2', type: 'whatsapp', title: 'New WhatsApp lead', detail: 'Priya Singh asking about 2BHK Habibganj budget ₹45L', time: '8m ago' },
  { id: 'act-3', type: 'call', title: 'Voice call completed', detail: 'Mohit Jain — 4m 22s · Site visit scheduled for Sunday', time: '23m ago' },
  { id: 'act-4', type: 'followup', title: 'Automated follow-up sent', detail: '12 cold leads re-engaged across WhatsApp', time: '1h ago' },
  { id: 'act-5', type: 'property', title: 'Property details shared', detail: 'Brochure sent for 4BHK Villa Chinar Park to Kavita Patel', time: '2h ago' },
];

let RECORDINGS: CallRecording[] = [
  {
    id: 'CALL-089',
    caller: 'Mohit Jain',
    phone: '+91 76543 21098',
    color: '#1A6BFF',
    init: 'MJ',
    date: 'Aug 6, 2026',
    time: '11:24 AM',
    dur: '4m 22s',
    outcome: 'booking',
    prop: '4BHK Villa, Chinar Park',
    waves: [30, 50, 70, 40, 60, 80, 55, 45, 65, 90, 75, 60, 40, 70, 85, 50, 65, 30, 55, 70, 45, 80, 60, 40, 75, 90, 55, 65, 30, 50, 45, 70, 85, 60, 40, 75, 55, 80, 40, 65],
    transcript: [
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Namaste! Prime Realty se Priya bol rahi hoon. Aap kisi property mein interested hain?' },
      { ai: false, spk: 'Mohit Jain', txt: 'Haan, mujhe 4BHK villa chahiye, budget 1.3 crore ke around.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Bilkul sir! Chinar Park mein premium 4BHK villa — ₹1.2Cr to ₹1.5Cr. Private pool, 3 parking, smart home. Site visit karein?' },
      { ai: false, spk: 'Mohit Jain', txt: 'Haan zaroor, Sunday ko available hoon.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Sunday August 10 ko 11 AM confirm. WhatsApp pe details aayegi. Broker Sunil Sharma aapko guide karenge. Thank you!' },
    ],
  },
  {
    id: 'CALL-088',
    caller: 'Kavita Rao',
    phone: '+91 65432 10987',
    color: '#F79009',
    init: 'KR',
    date: 'Aug 5, 2026',
    time: '3:45 PM',
    dur: '2m 58s',
    outcome: 'followup',
    prop: '3BHK Kolar Road',
    waves: [20, 40, 60, 80, 50, 70, 30, 60, 90, 45, 65, 75, 55, 40, 70, 80, 60, 40, 50, 70, 85, 45, 60, 30, 70, 55, 80, 40, 65, 50, 35, 60, 75, 55, 40, 70, 80, 50, 65, 45],
    transcript: [
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Namaste! Prime Realty se Priya. Property ke baare mein baat karni hai?' },
      { ai: false, spk: 'Kavita Rao', txt: 'Haan, 3BHK flat chahiye Kolar Road area mein.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: '₹65L-75L range mein ek excellent 3BHK hai. Kya aap abhi baat kar sakti hain?' },
      { ai: false, spk: 'Kavita Rao', txt: 'Abhi thodi busy hoon, kal call karna.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Bilkul ji! Kal follow-up karenge. Kya WhatsApp pe property details bhejun abhi?' },
    ],
  },
  {
    id: 'CALL-087',
    caller: 'Deepak Singh',
    phone: '+91 54321 09876',
    color: '#12B76A',
    init: 'DS',
    date: 'Aug 5, 2026',
    time: '10:12 AM',
    dur: '6m 01s',
    outcome: 'booking',
    prop: 'Plot 200sq.yd, Misrod',
    waves: [60, 80, 40, 70, 90, 55, 65, 45, 75, 30, 60, 85, 50, 70, 40, 80, 60, 45, 70, 90, 55, 65, 40, 80, 60, 50, 75, 30, 60, 85, 40, 70, 55, 80, 65, 45, 60, 75, 50, 70],
    transcript: [
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Namaste! Prime Realty ki taraf se. Aap plot khareedna chahte hain?' },
      { ai: false, spk: 'Deepak Singh', txt: 'Haan, Misrod area mein 200 gaj plot chahiye, investment ke liye.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: 'Sir! Misrod mein corner plot — ₹18L-22L. RERA approved. Excellent investment zone. Site visit karein?' },
      { ai: false, spk: 'Deepak Singh', txt: 'Haan main interested hoon.' },
      { ai: true, spk: 'AI Agent (Priya)', txt: 'August 7, 11 AM confirm kiya. Broker Meena Verma call karengi. Location WhatsApp pe bhej rahi hoon.' },
    ],
  },
];

export const REAL_ESTATE_AGENTS: RealEstateAgentState[] = [
  {
    id: 'agent-whatsapp',
    name: 'WhatsApp Chat Agent',
    role: 'Lead qualification & property matcher',
    runtime: 'n8n · AI Agent Node · GPT-4o Mini',
    status: 'online',
    desc: 'Handles all incoming WhatsApp & Meta Ads leads. Shares brochures, gathers requirements, and schedules site visits.',
    metrics: [
      { k: 'Conversations Today', v: '47' },
      { k: 'Avg Response Time', v: '< 2s' },
      { k: 'Bookings Today', v: '12' },
      { k: 'Memory Window', v: '20 turns' },
    ],
  },
  {
    id: 'agent-voice',
    name: 'Voice Call AI Agent',
    role: 'Direct call receptionist & booking intake',
    runtime: 'n8n + VAPI Webhook · GPT-4o',
    status: 'online',
    desc: 'Answers direct calls in Hindi and English, matches property criteria, and confirms site visits.',
    metrics: [
      { k: 'Calls Handled Today', v: '8 calls' },
      { k: 'Avg Call Duration', v: '4m 12s' },
      { k: 'Booking Conversion', v: '37.5%' },
      { k: 'Transcripts Captured', v: '100%' },
    ],
  },
  {
    id: 'agent-followup',
    name: 'Follow-up Scheduler',
    role: 'Cold lead re-engagement trigger',
    runtime: 'n8n · Cron Scheduler · Every 4h',
    status: 'running',
    desc: 'Sends personalized check-ins to unresponsive leads every 4 hours, capping at 3 attempts.',
    metrics: [
      { k: 'Leads in Queue', v: '23 pending' },
      { k: 'Messages Today', v: '31 sent' },
      { k: 'Re-engagement Rate', v: '28%' },
      { k: 'Next Run', v: 'In 1h 46m' },
    ],
  },
];

// ── Service Queries & Mutations ────────────────────────────

export function getProperties(): Property[] {
  return PROPERTIES;
}

export function addProperty(property: Omit<Property, 'id'> & { id?: string }): Property {
  const newProp: Property = {
    ...property,
    id: property.id || `PR-00${PROPERTIES.length + 1}`,
  };
  PROPERTIES = [newProp, ...PROPERTIES];
  addLiveActivity({
    type: 'property',
    title: 'New property listed',
    detail: `${newProp.name} in ${newProp.loc} (${newProp.price})`,
  });
  return newProp;
}

export function getBookings(): Booking[] {
  return BOOKINGS;
}

export function addBooking(booking: Omit<Booking, 'id'>): Booking {
  const newBooking: Booking = {
    ...booking,
    id: `BK-${1043 + BOOKINGS.length}`,
    createdAt: new Date().toISOString(),
  };
  BOOKINGS = [newBooking, ...BOOKINGS];
  addLiveActivity({
    type: 'booking',
    title: 'Site visit booked',
    detail: `${newBooking.client} — ${newBooking.property} (Assigned to ${newBooking.broker})`,
  });
  return newBooking;
}

export function getBrokers(): Broker[] {
  return BROKERS;
}

export function getBrokerLogs(): BrokerLogEntry[] {
  return BROKER_LOG;
}

export function getCallRecordings(): CallRecording[] {
  return RECORDINGS;
}

export function getLiveActivities(): LiveActivity[] {
  return ACTIVITIES;
}

export function addLiveActivity(act: Omit<LiveActivity, 'id' | 'time'>): LiveActivity {
  const newAct: LiveActivity = {
    ...act,
    id: `act-${Date.now()}`,
    time: 'Just now',
  };
  ACTIVITIES = [newAct, ...ACTIVITIES.slice(0, 19)];
  return newAct;
}

export interface FunnelMetricStage {
  id: string;
  label: string;
  count: number;
  pct: number;
}

export interface RealEstateOverviewStats {
  totalLeads: number;
  leadsDeltaPct: number;
  confirmedBookings: number;
  bookingsDeltaPct: number;
  activeProperties: number;
  pipelineValue: string;
  pipelineDeltaPct: number;
  funnelStages: FunnelMetricStage[];
  sources: { source: string; label: string; count: number; pct: number }[];
  activeBrokersCount: number;
}

export function getRealEstateOverview(): RealEstateOverviewStats {
  const activeProps = PROPERTIES.filter((p) => p.status === 'available').length;
  const confirmed = BOOKINGS.filter((b) => b.status === 'confirmed').length;

  return {
    totalLeads: 142,
    leadsDeltaPct: 18,
    confirmedBookings: confirmed,
    bookingsDeltaPct: 12,
    activeProperties: activeProps,
    pipelineValue: '₹4.2Cr',
    pipelineDeltaPct: 24,
    funnelStages: [
      { id: 'leads', label: 'Total Inbound Leads', count: 142, pct: 100 },
      { id: 'engaged', label: 'Engaged with AI Agent', count: 118, pct: 83 },
      { id: 'details', label: 'Requested Property Details', count: 76, pct: 54 },
      { id: 'visit', label: 'Site Visit Scheduled', count: 54, pct: 38 },
      { id: 'confirmed', label: 'Booking Confirmed', count: confirmed, pct: Math.round((confirmed / 142) * 100) },
    ],
    sources: [
      { source: 'meta', label: 'Meta / Instagram Ads', count: 67, pct: 47 },
      { source: 'whatsapp', label: 'WhatsApp Direct', count: 48, pct: 34 },
      { source: 'voice', label: 'Voice / Direct Call', count: 27, pct: 19 },
    ],
    activeBrokersCount: BROKERS.filter((b) => b.status === 'active').length,
  };
}
