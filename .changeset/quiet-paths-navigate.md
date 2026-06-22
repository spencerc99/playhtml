"@playhtml/react": patch

Prevent React shared-state components from re-registering their playhtml element when synced data updates only React state, avoiding render loops after room-change rebinds.
