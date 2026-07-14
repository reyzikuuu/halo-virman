import React, { useRef } from 'react';
import videosData from '../data/videos.json';

export default function VideoMarquee() {
  // We duplicate the array to create a seamless infinite loop
  const duplicatedVideos = [...videosData, ...videosData, ...videosData];

  return (
    <section className="relative w-full pt-0 md:pt-16 pb-20 overflow-hidden bg-black flex flex-col justify-center border-y border-white/10 -mt-2 md:mt-0">
      <div className="absolute inset-0 bg-linear-to-r from-black via-transparent to-black z-10 pointer-events-none" />
      
      <div className="flex flex-col items-center text-center mb-12 relative z-20">
        <h2 className="hero-title">
          <span className="text-[clamp(1.8rem,4vw,3rem)] font-extrabold text-white tracking-[-0.04em] leading-none">Portofolio<span className="accent-dot">.</span></span>
        </h2>
        <p className="hero-description mt-4 px-8 md:px-16 max-w-[500px]">
          halo dunia ini adalah portofolio video editing saya,
        </p>
      </div>

      <div className="flex w-fit animate-marquee hover:paused">
        {duplicatedVideos.map((video, index) => (
          <div
            key={`${video.id}-${index}`}
            className="shrink-0 mx-2 md:mx-3 w-[190px] md:w-[230px] h-[338px] md:h-[409px] rounded-2xl overflow-hidden relative group border border-white/10 transition-transform duration-300 hover:scale-[1.02]"
          >
            {/* Fallback Poster Image */}
            <img 
              src={video.poster} 
              alt={video.title} 
              className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-500 group-hover:opacity-0" 
            />
            
            {/* Video Element */}
            <video
              className="absolute inset-0 w-full h-full object-cover z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              muted
              loop
              playsInline
              preload="none"
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            >
              {/* Mobile WebM & MP4 (Max width 768px) */}
              <source src={video.src.mobile.webm} type="video/webm" media="(max-width: 768px)" />
              <source src={video.src.mobile.mp4} type="video/mp4" media="(max-width: 768px)" />
              
              {/* Desktop WebM & MP4 (Default) */}
              <source src={video.src.desktop.webm} type="video/webm" />
              <source src={video.src.desktop.mp4} type="video/mp4" />
            </video>
            
            {/* Overlay Gradient for Text */}
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            {/* Title */}
            <div className="absolute bottom-0 left-0 right-0 p-6 z-30 translate-y-4 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-300">
              <h3 className="text-white font-semibold text-lg">{video.title}</h3>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
