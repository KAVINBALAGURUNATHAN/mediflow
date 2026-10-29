import PatientAuth from "./PatientAuth";

// Thin wrapper - the real combined Sign In / Create Account UI lives in
// PatientAuth.jsx. Kept as its own file/route (/patient-login) so existing
// deep links and PatientProtectedRoute's redirect target keep working
// unchanged, without duplicating any auth logic.
function PatientLogin() {
  return <PatientAuth initialTab="login" />;
}

export default PatientLogin;
