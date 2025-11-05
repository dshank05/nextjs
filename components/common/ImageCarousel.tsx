import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn } from 'lucide-react';

interface CarouselItem {
  id: string;
  src: string;
  alt: string;
  type: 'image' | 'barcode';
}

interface ImageCarouselProps {
  items: CarouselItem[];
  className?: string;
  onZoom?: (src: string, alt: string) => void;
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  items,
  className = "",
  onZoom
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!items || items.length === 0) {
    return (
      <div className={`w-[28rem] h-80 bg-slate-600 rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-slate-400 font-medium text-center">
          <div className="text-4xl mb-2">📷</div>
          <div>NO IMAGES</div>
        </div>
      </div>
    );
  }

  // If only one item, show it without carousel controls
  if (items.length === 1) {
    const item = items[0];
    return (
      <div className={`relative ${className}`}>
        <div className="w-[28rem] h-80 bg-slate-600 rounded-xl overflow-hidden shadow-lg">
          <img
            src={item.src}
            alt={item.alt}
            className="w-full h-full object-cover"
          />
        </div>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? items.length - 1 : prev - 1));
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev === items.length - 1 ? 0 : prev + 1));
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Main Image Container */}
      <div className="w-[28rem] h-80 bg-slate-600 rounded-xl overflow-hidden shadow-lg relative group">
        <img
          src={currentItem.src}
          alt={currentItem.alt}
          className="w-full h-full object-cover"
        />

        {/* Navigation Arrows */}
        <button
          onClick={goToPrevious}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={goToNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation Dots */}
      <div className="flex justify-center space-x-2 mt-3">
        {items.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-2 h-2 rounded-full transition-colors ${
              index === currentIndex
                ? 'bg-blue-500'
                : 'bg-slate-400 hover:bg-slate-300'
            }`}
          />
        ))}
      </div>

      {/* Image Counter */}
      <div className="text-center mt-2">
        <span className="text-xs text-slate-500">
          {currentIndex + 1} of {items.length}
        </span>
      </div>
    </div>
  );
};
