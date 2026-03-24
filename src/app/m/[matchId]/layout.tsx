import MatchQueryProvider from "./providers";

export default function MatchDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MatchQueryProvider>{children}</MatchQueryProvider>;
}
