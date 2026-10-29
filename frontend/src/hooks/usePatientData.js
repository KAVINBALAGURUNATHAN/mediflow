import { useState, useEffect, useCallback } from "react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// Shared data-loading for every authenticated patient page (dashboard,
// my-appointments, medical reports, profile, appointment detail) so they
// all read from the same two calls instead of five separate copies of the
// same fetch/loading/error boilerplate.
function usePatientData() {
  const toast = useToast();
  const [patient, setPatient] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const [profileRes, appointmentsRes] = await Promise.all([
        API.get("/patient/profile"),
        API.get("/patient/appointments"),
      ]);

      setPatient(profileRes.data.patient);
      setAppointments(appointmentsRes.data.appointments || []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load your data");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadReport = async (appointment) => {
    try {
      // Under /patient so the interceptor attaches the patient token; the
      // server derives ownership from it rather than a phone we send.
      const response = await API.get(`/patient/appointments/${appointment._id}/report`, {
        responseType: "blob",
      });

      const file = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(file);
      const link = document.createElement("a");

      link.href = url;
      link.download = `Medical-Report-${appointment.bookingId}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Unable to download medical report.");
    }
  };

  return { patient, appointments, loading, reload: load, downloadReport };
}

export default usePatientData;
