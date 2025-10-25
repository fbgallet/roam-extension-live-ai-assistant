/**
 * Chat Page Autocomplete Component
 *
 * Displays a filtered list of page titles for autocompletion when user types [[
 */

import React from "react";
import { Menu, MenuItem, Spinner } from "@blueprintjs/core";

interface ChatPageAutocompleteProps {
  pages: string[];
  onPageSelect: (pageTitle: string) => void;
  isLoading: boolean;
  query: string;
}

const ChatPageAutocomplete: React.FC<ChatPageAutocompleteProps> = ({
  pages,
  onPageSelect,
  isLoading,
  query,
}) => {
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Reset active index when pages change
  React.useEffect(() => {
    if (activeIndex >= pages.length) {
      setActiveIndex(Math.max(0, pages.length - 1));
    }
  }, [pages.length, activeIndex]);

  // Handle keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.min(prev + 1, pages.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if ((e.key === "Enter" || e.key === "Tab") && pages[activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        onPageSelect(pages[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        // Parent will handle closing
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeIndex, pages, onPageSelect]);

  if (isLoading) {
    return (
      <Menu className="chat-page-autocomplete-menu">
        <MenuItem
          disabled={true}
          icon={<Spinner size={16} />}
          text="Loading pages..."
        />
      </Menu>
    );
  }

  if (!pages.length) {
    return (
      <Menu className="chat-page-autocomplete-menu">
        <MenuItem disabled={true} text={`No pages found for "${query}"`} />
      </Menu>
    );
  }

  return (
    <Menu className="chat-page-autocomplete-menu">
      {pages.map((page, index) => (
        <MenuItem
          key={page}
          text={page}
          active={index === activeIndex}
          onClick={() => onPageSelect(page)}
        />
      ))}
    </Menu>
  );
};

export default ChatPageAutocomplete;
