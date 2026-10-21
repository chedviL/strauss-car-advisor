// src/app/prototype/page.tsx
// אב-טיפוס חזותי נפרד לבדיקה (נתוני הדגמה בלבד, ללא קריאות מודל / התחברות).
// נתיב: /prototype
import type { Metadata } from "next";
import { PrototypeClient } from "./PrototypeClient.js";
import "./prototype.css";

export const metadata: Metadata = {
  title: "אב-טיפוס · יועץ הרכב של שטראוס",
  description: "אב-טיפוס חזותי אינטראקטיבי - הדגמה בלבד",
};

export default function PrototypePage() {
  return <PrototypeClient />;
}
