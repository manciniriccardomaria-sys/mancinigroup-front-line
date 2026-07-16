import React, { useEffect, useState } from 'react';
import { 
  HashRouter as Router, 
  Routes, 
  Route, 
  Navigate,
  useLocation
} from 'react-router-dom';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getAuthorizedUser, UserProfile } from './constants';
import Login from './components/Login';
import EmployeeDashboard from './components/EmployeeDashboard';
import AdminDashboard from './components/AdminDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { AlertTriangle, Loader2, LogOut, RefreshCw } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setProfileError('');

      if (currentUser) {
        const authorizedUser = getAuthorizedUser(currentUser.email);

        if (!authorizedUser) {
          setUser(null);
          setProfile(null);
          setAccessError('Questo indirizzo email non è autorizzato ad accedere all’app.');
          await signOut(auth);
          setLoading(false);
          return;
        }

        setAccessError('');

        const desiredProfile: UserProfile = {
          uid: currentUser.uid,
          name: authorizedUser.name,
          email: currentUser.email || '',
          role: authorizedUser.role,
        };

        try {
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await withTimeout(getDoc(docRef), 12000);
          const storedProfile = docSnap.exists()
            ? docSnap.data() as UserProfile
            : undefined;

          if (storedProfile) {
            const updatedProfile = {
              ...storedProfile,
              ...desiredProfile,
            };

            if (
              storedProfile.name !== updatedProfile.name ||
              storedProfile.email !== updatedProfile.email ||
              storedProfile.role !== updatedProfile.role
            ) {
              await withTimeout(setDoc(docRef, updatedProfile), 12000);
            }

            setProfile(updatedProfile);
          } else {
            await withTimeout(setDoc(docRef, desiredProfile), 12000);
            setProfile(desiredProfile);
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          if (canUseLocalAuthorizedProfile(err)) {
            setProfile(desiredProfile);
            setProfileError('');
          } else {
            setProfile(null);
            setProfileError(getProfileErrorMessage(err));
          }
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-[#003781] animate-spin" />
        <p className="mt-4 text-slate-600 font-medium">Caricamento ManciniGroup...</p>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-red-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Database non disponibile</h1>
          <p className="text-slate-600 mb-6">{profileError}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 w-full bg-[#003781] text-white py-3 rounded-xl font-semibold hover:bg-[#002a63] transition-colors"
            >
              <RefreshCw size={20} />
              Riprova
            </button>
            <button
              onClick={() => auth.signOut()}
              className="flex items-center justify-center gap-2 w-full border border-slate-300 text-slate-700 py-3 rounded-xl font-semibold hover:bg-slate-50 transition-colors"
            >
              <LogOut size={20} />
              Esci
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route 
            path="/login" 
            element={user ? <Navigate to="/" replace /> : <Login initialError={accessError} />}
          />
          
          <Route 
            path="/" 
            element={
              <ProtectedRoute user={user} profile={profile}>
                {profile?.role === 'admin' ? <AdminDashboard /> : <EmployeeDashboard />}
              </ProtectedRoute>
            } 
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

function ProtectedRoute({ 
  user, 
  profile, 
  children 
}: { 
  user: User | null; 
  profile: UserProfile | null;
  children: React.ReactNode 
}) {
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('firestore-timeout')), timeoutMs);
    }),
  ]);
}

function getProfileErrorMessage(error: unknown) {
  const code = getFirestoreErrorCode(error);

  if (code.includes('permission-denied')) {
    return 'Firebase ha rifiutato l\'accesso. Pubblica le regole Firestore aggiornate e riprova.';
  }

  if (code.includes('resource-exhausted')) {
    return 'Firestore ha esaurito la quota giornaliera di letture. Riprova quando la quota si resetta o passa il progetto a un piano con più capacità.';
  }

  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'Firestore non è temporaneamente raggiungibile. Riprova tra poco.';
  }

  if (error instanceof Error && error.message === 'firestore-timeout') {
    return 'La connessione a Firestore sta impiegando troppo tempo. Controlla la configurazione Firebase e la rete.';
  }

  return 'Non è stato possibile caricare il profilo. Controlla Firestore e riprova.';
}

function canUseLocalAuthorizedProfile(error: unknown) {
  const code = getFirestoreErrorCode(error);
  return code.includes('resource-exhausted') ||
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    (error instanceof Error && error.message === 'firestore-timeout');
}

function getFirestoreErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return String(error.code);
  }

  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  return '';
}
