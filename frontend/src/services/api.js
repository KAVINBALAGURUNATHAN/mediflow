import axios from 'axios';

const BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ===========================
// ATTACH JWT TOKEN
// ===========================
api.interceptors.request.use(
  (config) => {
    const doctorToken = localStorage.getItem('doctorToken');
    const adminToken = localStorage.getItem('adminToken');
    const receptionistToken = localStorage.getItem('receptionistToken');
    const nurseToken = localStorage.getItem('nurseToken');
    const labTechnicianToken = localStorage.getItem('labTechnicianToken');
    const token = localStorage.getItem('token');

    let authToken = null;

    // Receptionist routes must use receptionist token
    if (config.url?.startsWith('/receptionist/')) {
      authToken = receptionistToken;
    }

    // Nurse routes must use nurse token
    else if (config.url?.startsWith('/nurse/')) {
      authToken = nurseToken;
    }

    // Lab technician routes must use the lab technician token
    else if (config.url?.startsWith('/lab-technician/')) {
      authToken = labTechnicianToken;
    }

    // Doctor routes must use doctor token
    else if (config.url?.startsWith('/doctor/')) {
      authToken = doctorToken;
    }

    // Admin routes must use admin token
    else if (config.url?.startsWith('/admin/')) {
      authToken = adminToken;
    }

    // Other existing protected routes
    else {
      authToken =
        doctorToken ||
        receptionistToken ||
        nurseToken ||
        labTechnicianToken ||
        adminToken ||
        token;
    }

    if (authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ===========================
// NORMALISE API ERRORS
// ===========================
// Rejects with an Error whose `message` is what the server said, while
// KEEPING the axios shape on it.
//
// It used to reject with a bare `new Error(message)`, which threw away
// `error.response`. Every catch block written against axios - and most of
// this app is - reads `err.response?.data?.message`, so all of them got
// `undefined` and fell through to their own generic fallback. A duplicate
// lab order came back as a 409 saying exactly what was wrong and the doctor
// was shown "Could not order the test"; a failed cancel told the desk
// "Failed to cancel appointment" and nothing else.
//
// Re-attaching the fields fixes every caller at once, in both styles: code
// reading `err.message` keeps working, and code reading `err.response`
// starts working again. The alternative was editing 27 files to read a
// second shape, which leaves the trap in place for the 28th.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.message ||
      error.message ||
      'Something went wrong';

    const wrapped = new Error(message);

    wrapped.response = error.response;
    wrapped.status = error.response?.status;
    wrapped.data = error.response?.data;
    // Preserved so a caller can still tell a timeout or a dropped connection
    // apart from a real HTTP error, which `response` alone cannot express.
    wrapped.code = error.code;

    return Promise.reject(wrapped);
  }
);

// ==================================================
// DOCTOR LIVE QUEUE
// APPOINTMENT MODEL ONLY
// ==================================================
export const liveQueueAPI = {
  getAll: () =>
    api.get('/doctor/live-queue'),

  // There is no backend "call next" endpoint - calling the next token is a
  // two-step flow: find who's next, then start their consultation.
  getNextPatient: () =>
    api.get('/doctor/dashboard/next-patient'),

  startConsultation: (appointmentId) =>
    api.patch(`/doctor/appointments/${appointmentId}/start-consultation`),

  // Doctor's own per-patient time estimate, set once they've actually seen
  // the patient - refines the wait estimate shown to everyone behind them
  // in the queue beyond the flat clinic-wide average.
  setEstimatedDuration: (appointmentId, estimatedDurationMinutes) =>
    api.patch(`/doctor/appointments/${appointmentId}/estimated-duration`, {
      estimatedDurationMinutes,
    }),
};

// ==================================================
// RECEPTIONIST APPOINTMENT API
// APPOINTMENT MODEL ONLY
// ==================================================
// ==================================================
// DOCTOR CLINICAL RECORDS
// Prescriptions and lab orders written during a consultation, plus the
// patient's earlier records - see routes/doctorRoutes.js.
// ==================================================
export const clinicalAPI = {
  getRecords: (appointmentId) =>
    api.get(`/doctor/appointments/${appointmentId}/records`),

  issuePrescription: (appointmentId, medicines, notes = '') =>
    api.post(`/doctor/appointments/${appointmentId}/prescription`, {
      medicines,
      notes,
    }),

  // Legacy: fills in a LabResult created by the old free-text ordering flow.
  // New orders are LabOrders and are reported by the technician.
  updateLabResult: (labResultId, payload) =>
    api.patch(`/doctor/lab-results/${labResultId}`, payload),

  // --- Catalog-based lab ordering (Phase 3) ---

  // Active catalog tests the doctor may order. Read-only: the catalog itself
  // is admin-owned.
  getOrderableTests: () => api.get('/doctor/lab-tests'),

  // Ordering a test and reporting its values are separate steps: the test is
  // ordered during the consultation and comes back later. The doctor sends a
  // labTestId - never a test name, and never parameters, which belong to the
  // LabTest definition.
  orderLabTest: (appointmentId, labTestId, note = '') =>
    api.post(`/doctor/appointments/${appointmentId}/lab-orders`, {
      labTestId,
      note,
    }),

  // Withdraws an order placed by mistake. It is cancelled, never deleted.
  cancelLabOrder: (labOrderId) =>
    api.patch(`/doctor/lab-orders/${labOrderId}/cancel`),
};

export const receptionistAPI = {
  getAppointments: () =>
    api.get('/receptionist/appointments'),

  // Today + the next 30 days, for the Tomorrow/Future Bookings sections.
  getUpcomingAppointments: () =>
    api.get('/receptionist/appointments?scope=upcoming'),

  // Check-in records arrival only. Vitals are the nurse's - see nurseAPI.
  checkIn: (id, priority = 'Normal', priorityReason = '') =>
    api.patch(
      `/receptionist/appointments/${id}/check-in`,
      {
        priority,
        priorityReason,
      }
    ),

  updatePriority: (id, priority, priorityReason = '') =>
    api.patch(
      `/receptionist/appointments/${id}/priority`,
      {
        priority,
        priorityReason,
      }
    ),

  // The late-arrival decision, kept side by side with addToWaitingList below
  // so the two halves of it are read together.
  keepInQueue: (id) =>
    api.patch(`/receptionist/appointments/${id}/keep-in-queue`),

  cancelAppointment: (id) =>
    api.patch(`/receptionist/appointments/${id}/cancel`),

  // --- Waiting / vacant list (Phase 7) ---
  // Nothing here cancels an appointment because its slot time passed. A late
  // patient stays checked-in and keeps their slot; only markNoShow frees one.

  getWaitingList: (doctorId) =>
    api.get(
      `/receptionist/waiting-list${doctorId ? `?doctorId=${doctorId}` : ''}`
    ),

  // A walk-in by phone, or a late patient carried over from their appointment.
  addToWaitingList: (payload) =>
    api.post('/receptionist/waiting-list', payload),

  removeFromWaitingList: (id) =>
    api.patch(`/receptionist/waiting-list/${id}/remove`),

  // Slots this doctor genuinely has free for the rest of today.
  getVacancies: (doctorId) =>
    api.get(`/receptionist/vacancies?doctorId=${doctorId}`),

  assignVacancy: (id, slot) =>
    api.post(`/receptionist/waiting-list/${id}/assign`, { slot }),

  // Gives the slot to whoever is at the FRONT of the list - priority first,
  // then longest waiting. The right action for an ordinary vacancy; picking a
  // specific patient stays available for the cases that need judgement.
  assignNextWaiting: (doctorId, slot) =>
    api.post('/receptionist/waiting-list/assign-next', { doctorId, slot }),

  // The ONLY thing that turns a booking into a vacancy.
  markNoShow: (id) =>
    api.patch(`/receptionist/appointments/${id}/no-show`),

  // --- Recovery window ---
  // A period held for patients still on the waiting list, one block per slot,
  // so normal appointments outside it are untouched.

  openRecoveryWindow: (doctorId, start, end) =>
    api.post('/receptionist/recovery-window', { doctorId, start, end }),

  closeRecoveryWindow: (doctorId) =>
    api.delete(`/receptionist/recovery-window?doctorId=${doctorId}`),
};

// ==================================================
// PUBLIC WAITING ROOM STATUS
// Token numbers are only unique per doctor per day, so the backend
// requires both doctorId and tokenNumber - see GET
// /waiting-room/:doctorId/:tokenNumber in server.js.
// ==================================================
export const waitingRoomAPI = {
  getStatus: (doctorId, tokenNumber) =>
    api.get(`/waiting-room/${doctorId}/${tokenNumber}`),
};

// ===========================
// CONSULTATION SETTINGS
// ===========================
export const settingsAPI = {
  getTime: () =>
    api.get('/consultation-time'),

  setTime: (time) =>
    api.post('/consultation-time', {
      time,
    }),
};

// ===========================
// NURSE
// ===========================
// Clinical preparation: the nurse measures the patient after the receptionist
// has checked them in, then hands them to the doctor.
export const nurseAPI = {
  login: (email, password) =>
    api.post('/nurse/login', { email, password }),

  getProfile: () =>
    api.get('/nurse/profile'),

  // Returns { awaitingVitals, readyForDoctor } - today's checked-in patients
  // split by whether the nurse has handed them over yet.
  getQueue: () =>
    api.get('/nurse/queue'),

  // Records and corrects through the same endpoint. Every field blank clears
  // the panel and withdraws the hand-off. BMI is never sent - the server
  // derives it from height and weight.
  recordVitals: (id, vitals) =>
    api.patch(`/nurse/appointments/${id}/vitals`, vitals),

  markReady: (id) =>
    api.patch(`/nurse/appointments/${id}/ready`),
};

// ===========================
// LAB TECHNICIAN
// ===========================
// The laboratory's worklist. Orders arrive here from the doctor (Phase 3);
// recording their values is Phase 5.
export const labTechnicianAPI = {
  login: (email, password) =>
    api.post('/lab-technician/login', { email, password }),

  getProfile: () => api.get('/lab-technician/profile'),

  // Returns { pending, inProgress } across all patients, oldest first.
  getWorklist: () => api.get('/lab-technician/worklist'),

  // Ordered -> In Progress.
  startTest: (labOrderId) =>
    api.patch(`/lab-technician/lab-orders/${labOrderId}/start`),

  // The form DEFINITION for one order: its LabTest parameters, plus any draft
  // already saved. The fields are generated from this - see LabResultForm.jsx.
  getResultForm: (labOrderId) =>
    api.get(`/lab-technician/lab-orders/${labOrderId}/result`),

  // Save a draft, or complete the report with { complete: true }. Values and
  // flags are keyed by parameter NAME; the server rebuilds them against the
  // definition, so nothing here can invent or rename a parameter.
  saveResult: (labOrderId, { values, flags, summary, complete }) =>
    api.patch(`/lab-technician/lab-orders/${labOrderId}/result`, {
      values,
      flags,
      summary,
      complete,
    }),
};

export default api;