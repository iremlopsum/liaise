// The analytics project's public web config: public by design, it identifies the project; the
// Firestore rules are what protect the data. COLLECT_HOSTS: the only hosts that send.
// The collector imports PROJECT_ID and API_KEY alone, so the dashboard's fields stay out of its bundle.
export const PROJECT_ID = 'liaise-analytics'
export const API_KEY = 'AIzaSyAMwQ-ItjpJdkTxySToo9vI_LYrdVH9iYY'
export const FIREBASE = {
  projectId: PROJECT_ID,
  apiKey: API_KEY,
  authDomain: 'liaise-analytics.firebaseapp.com',
  appId: '1:873827672196:web:d4cc33448925a7305ce2d1',
} as const
export const COLLECT_HOSTS = ['iremlopsum.github.io']
