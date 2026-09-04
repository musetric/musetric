import { type CSSProperties } from 'react';
import logoUrl from '../favicon.svg';

const logoSize = 160;

const screenStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const logoStyle: CSSProperties = {
  width: logoSize,
  height: logoSize,
};

const captionStyle: CSSProperties = {
  position: 'absolute',
  top: `calc(50% + ${logoSize / 2 + 24}px)`,
  left: 0,
  right: 0,
  margin: 0,
  padding: '0 24px',
  color: '#8a8a8a',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 1.5,
  textAlign: 'center',
};

export const App = () => (
  <div style={screenStyle}>
    <img style={logoStyle} src={logoUrl} alt='Musetric' />
    <p style={captionStyle}>The Musetric app is coming soon.</p>
  </div>
);
