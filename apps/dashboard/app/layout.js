import "./globals.css";

export const metadata = {
  title: "Evacuva",
  description: "Live evacuation routing prototype",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
