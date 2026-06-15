import { Navigate, useParams } from "react-router-dom";

export default function MatchHubPage() {
  const { id } = useParams();
  return <Navigate to={`/matches/${id}`} replace />;
}
