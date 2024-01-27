const ConfettiEvent = new Event('confetti')

export function Confetti() {
    window.dispatchEvent(ConfettiEvent)
}

interface ReactionEvent {
    type: 'reaction';
    emoji: string;
    size?: number;
}
export function LiveReaction() {
    window.dispatchEvent({
        type: 
    })
}
