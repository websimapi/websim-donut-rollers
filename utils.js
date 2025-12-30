// Utility functions
export function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

export function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}