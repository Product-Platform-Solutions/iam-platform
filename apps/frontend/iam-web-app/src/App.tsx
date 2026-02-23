import { useKeycloak } from '@react-keycloak/web';

function App() {
  const { keycloak, initialized } = useKeycloak();

  if (!initialized) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>IAM Platform</h1>
      {keycloak.authenticated ? (
        <div>
          <p>✅ Logged in as: <strong>{keycloak.tokenParsed?.preferred_username}</strong></p>
          <p>Email: {keycloak.tokenParsed?.email}</p>
          <p>Roles: {keycloak.tokenParsed?.realm_access?.roles?.join(', ')}</p>
          <button onClick={() => keycloak.logout()}>Logout</button>
        </div>
      ) : (
        <div>
          <p>You are not logged in.</p>
          <button onClick={() => keycloak.login()}>Login with SSO</button>
        </div>
      )}
    </div>
  );
}

export default App;
