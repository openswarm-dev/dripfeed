"use client";

import { TokenImage } from "@/components/ui/TokenImage";
import { LiveAge } from "@/components/narra/LiveAge";
import { capitalize } from "@/lib/narra/format";
import { displayTheme } from "@/lib/narra/displayTheme";
import type { TimelineEvent } from "@/lib/narra/heat";

const STAGE_LABELS: Record<string, string> = {
  spark: "Spark",
  naming: "Naming",
  recognition: "Recognition",
  copycat: "Copycat wave",
  momentum: "Money follows",
  peak: "Peak",
  fade: "Fade",
  launch: "Launch",
};

export function OpportunityFeedCard({
  ev,
  flash,
}: {
  ev: TimelineEvent;
  flash: boolean;
}) {
  const tierClass = ev.tier > 0 ? `timeline-event--tier-${ev.tier}` : "";
  const flashClass = flash ? "timeline-event--flash" : "";
  const stageLabel = STAGE_LABELS[ev.stage] ?? capitalize(ev.stage);
  const title = ev.isLaunch ? ev.theme : displayTheme(ev.theme);

  return (
    <article
      className={`opp-feed-card timeline-event ${tierClass} ${flashClass} ${ev.isLaunch ? "timeline-event--launch" : ""}`}
    >
      <div className="opp-feed-card__row">
        <TokenImage src={ev.image} size={40} className="opp-feed-card__img" priority />
        <div className="opp-feed-card__body">
          <div className="opp-feed-card__badges">
            {ev.tier >= 2 && <span className="opp-badge">OPPORTUNITY</span>}
            <span className="opp-badge">{stageLabel}</span>
          </div>
          <h3 className="opp-feed-card__title" title={title}>
            {ev.isLaunch ? title : `"${title}"`}
          </h3>
          {ev.stats && <p className="opp-feed-card__stats">{ev.stats}</p>}
          {!ev.isLaunch && ev.label && ev.label !== ev.stats && (
            <p className="opp-feed-card__detail">{ev.label}</p>
          )}
          {ev.isLaunch && ev.label && (
            <p className="opp-feed-card__detail">{ev.label}</p>
          )}
        </div>
        <span className="opp-feed-card__time"><LiveAge ts={ev.at} /></span>
      </div>
    </article>
  );
}
