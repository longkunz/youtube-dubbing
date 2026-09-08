import React, { useState } from 'react';
import { FloatingPill } from './FloatingPill';
import { CyberCockpit } from './CyberCockpit';

export const HudContainer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="hud-wrapper">
      <FloatingPill isOpen={isOpen} onToggle={() => setIsOpen((prev) => !prev)} />
      <CyberCockpit isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </div>
  );
};
