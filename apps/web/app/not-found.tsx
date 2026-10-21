import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone">
      <p>404</p>
      <h1>页面不存在</h1>
      <Link href="/dashboard">返回概览</Link>
    </main>
  );
}
