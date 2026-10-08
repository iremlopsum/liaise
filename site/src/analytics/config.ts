// The analytics project's public web config: public by design, it identifies the project; the
// Firestore rules are what protect the data. COLLECT_HOSTS: the only hosts that send.
export const FIREBASE = {
  projectId: 'liaise-analytics',
  apiKey: 'AIzaSyAMwQ-ItjpJdkTxySToo9vI_LYrdVH9iYY',
  authDomain: 'liaise-analytics.firebaseapp.com',
  appId: '1:873827672196:web:d4cc33448925a7305ce2d1',
} as const
export const COLLECT_HOSTS = ['iremlopsum.github.io']
