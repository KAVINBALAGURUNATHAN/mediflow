import PatientAuth from "./PatientAuth";

// Thin wrapper - the real combined Sign In / Create Account UI lives in
// PatientAuth.jsx. Kept as its own file/route (/patient-register) so
// existing deep links keep working unchanged, without duplicating any
// auth logic.
function PatientRegister() {
  return <PatientAuth initialTab="register" />;
}

export default PatientRegister;
