import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import type { Availability } from "@calcom/prisma/client";

export type DateRange = {
  start: Dayjs;
  end: Dayjs;
};

export type DateOverride = Pick<Availability, "date" | "startTime" | "endTime">;
export type WorkingHours = Pick<Availability, "days" | "startTime" | "endTime">;

type ProcessorParams = {
  timeZone?: string;
  dateFrom: Dayjs;
  dateTo: Dayjs;
};

export function processWorkingHours({
  item,
  timeZone,
  dateFrom,
  dateTo,
}: ProcessorParams & { item: WorkingHours }) {
  const results = [];
  for (let date = dateFrom.tz(timeZone); date.isBefore(dateTo); date = date.add(1, "day")) {
    if (!item.days.includes(date.day())) {
      continue;
    }
    results.push({
      start: date.hour(item.startTime.getUTCHours()).minute(item.startTime.getUTCMinutes()).second(0),
      end: date.hour(item.endTime.getUTCHours()).minute(item.endTime.getUTCMinutes()).second(0),
    });
  }
  return results;
}

export function processDateOverride({ item, timeZone }: ProcessorParams & { item: DateOverride }) {
  const date = dayjs.tz(item.date, timeZone);
  return {
    start: date.hour(item.startTime.getUTCHours()).minute(item.startTime.getUTCMinutes()).second(0),
    end: date.hour(item.endTime.getUTCHours()).minute(item.endTime.getUTCMinutes()).second(0),
  };
}

export function buildDateRanges({
  availability,
  timeZone /* Organizer timeZone */,
  dateFrom /* Attendee dateFrom */,
  dateTo /* `` dateTo */,
}: {
  timeZone: string;
  availability: (DateOverride | WorkingHours)[];
  dateFrom: Dayjs;
  dateTo: Dayjs;
}): DateRange[] {
  const groupedWorkingHours = groupByDate(
    availability.reduce((processed: DateRange[], item) => {
      if ("days" in item) {
        processed = processed.concat(processWorkingHours({ item, dateFrom, dateTo }));
      }
      return processed;
    }, [])
  );
  const groupedDateOverrides = groupByDate(
    availability.reduce((processed: DateRange[], item) => {
      if ("date" in item) {
        processed.push(processDateOverride({ item, timeZone, dateFrom, dateTo }));
      }
      return processed;
    }, [])
  );

  const dateRanges = Object.values({
    ...groupedWorkingHours,
    ...groupedDateOverrides,
  }).flat();

  return intersect([dateRanges, [{ start: dateFrom, end: dateTo }]]);
}

//group by date is not yet working correctly
export function groupByDate(ranges: DateRange[]): { [x: string]: DateRange[] } {
  const results = ranges.reduce(
    (
      previousValue: {
        [date: string]: DateRange[];
      },
      currentValue
    ) => {
      const dateString = currentValue.start.format("YYYY-MM-DD");
      previousValue[dateString] =
        typeof previousValue[dateString] === "undefined"
          ? [currentValue]
          : [...previousValue[dateString], currentValue];
      return previousValue;
    },
    {}
  );

  return results;
}

export function intersect(ranges: DateRange[][]): DateRange[] {
  // Get the ranges of the first user
  let commonAvailability = ranges[0];

  // For each of the remaining users, find the intersection of their ranges with the current common availability
  for (let i = 1; i < ranges.length; i++) {
    const userRanges = ranges[i];

    const intersectedRanges: {
      start: Dayjs;
      end: Dayjs;
    }[] = [];

    commonAvailability.forEach((commonRange) => {
      userRanges.forEach((userRange) => {
        const intersection = getIntersection(commonRange, userRange);
        if (intersection !== null) {
          // If the current common range intersects with the user range, add the intersected time range to the new array
          intersectedRanges.push(intersection);
        }
      });
    });

    commonAvailability = intersectedRanges;
  }

  // If the common availability is empty, there is no time when all users are available
  if (commonAvailability.length === 0) {
    return [];
  }

  return commonAvailability;
}

function getIntersection(range1: DateRange, range2: DateRange) {
  const start = range1.start.isAfter(range2.start) ? range1.start : range2.start;
  const end = range1.end.isBefore(range2.end) ? range1.end : range2.end;
  if (start.isBefore(end)) {
    return { start, end };
  }
  return null;
}

// first version
export function subtract(sourceRanges: DateRange[], excludedRanges: DateRange[]) {
  const result: DateRange[] = [];

  for (const { start: sourceStart, end: sourceEnd } of sourceRanges) {
    let currentStart = sourceStart;

    const overlappingRanges = excludedRanges.filter(
      ({ start, end }) => start.isBefore(sourceEnd) && end.isAfter(sourceStart)
    );

    for (const { start: excludedStart, end: excludedEnd } of overlappingRanges) {
      if (excludedStart.isAfter(currentStart)) {
        result.push({ start: currentStart, end: excludedStart });
      }
      currentStart = excludedEnd.isAfter(currentStart) ? excludedEnd : currentStart;
    }

    if (sourceEnd.isAfter(currentStart)) {
      result.push({ start: currentStart, end: sourceEnd });
    }
  }

  return result;
}
