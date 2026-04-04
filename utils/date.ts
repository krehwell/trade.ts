export const fmt = (d: Date): string => d.toISOString().slice(0, 10);

export const today = (): string => fmt(new Date());

export const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return fmt(d);
};

export const subDays = (d: Date, n: number): Date => {
    const r = new Date(d);
    r.setDate(r.getDate() - n);
    return r;
};

export const parseTFDays = (tf: string): number => {
    const match = tf.match(/^(\d+)([dwm])$/i);
    if (!match) throw new Error(`Invalid timeframe: ${tf}`);
    const [, n, unit] = match;
    if (unit === "d") return Number(n);
    if (unit === "w") return Number(n) * 7;
    if (unit === "m") return Number(n) * 30;
    throw new Error(`Invalid timeframe unit: ${unit}`);
};
