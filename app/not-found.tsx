import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px",
        background: "linear-gradient(180deg, #f7faff, #eef4ff)",
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          padding: "32px",
          border: "1px solid #d7e3ff",
          borderRadius: "24px",
          background: "#fff",
          boxShadow: "0 20px 48px rgba(36, 88, 245, 0.12)",
          textAlign: "center",
        }}
      >
        <strong style={{ display: "block", fontSize: "32px", color: "#1f2f52" }}>404</strong>
        <h1 style={{ margin: "12px 0 10px", fontSize: "24px", color: "#223457" }}>页面不存在</h1>
        <p style={{ margin: "0 0 18px", color: "#5a6782", lineHeight: 1.7 }}>
          你访问的页面不存在，可能已经被移动，或者链接地址有误。
        </p>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            minHeight: "42px",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 18px",
            borderRadius: "999px",
            color: "#fff",
            background: "linear-gradient(135deg, #2458f5, #5b6cff)",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
