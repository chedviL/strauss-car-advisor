// src/features/advisor/vehicle-match/icons.tsx
// אייקונים עקביים (lucide-react, הספרייה הקיימת בפרויקט) לכרטיסי הבחירה.
"use client";

import {
  Ban, Baby, Briefcase, Building, Bus, CircleQuestionMark, Coins, House, Luggage, Minimize2, Package,
  PlugZap, Route, Scale, Shuffle, ShoppingBag, User, UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";
import type { IconKey } from "./copy.js";

const MAP: Record<IconKey, ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  solo: User, group: UsersRound, bus: Bus,
  bag: ShoppingBag, stroller: Baby, luggage: Luggage,
  city: Building, mixed: Shuffle, route: Route,
  home: House, plug: PlugZap, none: Ban, unsure: CircleQuestionMark,
  wallet: Coins, package: Package, compact: Minimize2, balance: Scale,
};

export function ChoiceIcon({ name, size = 22 }: { name: IconKey; size?: number }) {
  const Cmp = MAP[name] ?? Briefcase;
  return <Cmp size={size} strokeWidth={1.8} aria-hidden={true} />;
}
