import type { Therapist } from "../types";

export const isAdmin = (me: Therapist | null) => !!me && (me.role === "owner" || me.role === "admin");
export const isSupervisor = (me: Therapist | null) => !!me && (isAdmin(me) || me.role === "supervisor");
export const isClinical = (me: Therapist | null) => !!me && me.role !== "me_officer";
export const canReport = (me: Therapist | null) => !!me && (isSupervisor(me) || me.role === "me_officer");
