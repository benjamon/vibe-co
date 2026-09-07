import { toNormalizedEvent } from "../normalize.js";
import type { FetchResult, NormalizedEvent } from "../types.js";

const MEETUP_GRAPHQL_ENDPOINT = "https://api.meetup.com/gql-ext";

const QUERY = /* GraphQL */ `
  query GroupEvents($urlname: String!) {
    groupByUrlname(urlname: $urlname) {
      name
      upcomingEvents(input: { first: 20 }) {
        edges {
          node {
            id
            title
            description
            eventUrl
            dateTime
            endTime
            venue {
              name
              address
              city
            }
          }
        }
      }
    }
  }
`;

interface MeetupNode {
  title: string;
  description?: string;
  eventUrl: string;
  dateTime: string;
  endTime?: string;
  venue?: { name?: string; address?: string; city?: string };
}

interface MeetupResponse {
  data?: {
    groupByUrlname?: {
      upcomingEvents?: { edges?: { node: MeetupNode }[] };
    } | null;
  };
  errors?: { message: string }[];
}

/**
 * Meetup requires a Meetup Pro subscription plus an approved OAuth consumer to
 * call the GraphQL API at all (their public search API was retired in 2020,
 * same as Eventbrite's). This connector is opt-in: set MEETUP_ACCESS_TOKEN and
 * MEETUP_GROUP_URLNAMES (comma-separated group slugs, e.g. "bellingham-hikers").
 * Docs: https://www.meetup.com/graphql/ — verify the schema still matches
 * before relying on this, as Meetup has changed it before.
 */
export async function fetchMeetupSource(groupUrlname: string, accessToken: string): Promise<FetchResult> {
  const sourceName = `Meetup (${groupUrlname})`;
  try {
    const res = await fetch(MEETUP_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: QUERY, variables: { urlname: groupUrlname } }),
    });
    if (!res.ok) {
      return { sourceName, events: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as MeetupResponse;
    if (data.errors?.length) {
      return { sourceName, events: [], error: data.errors.map((e) => e.message).join("; ") };
    }

    const edges = data.data?.groupByUrlname?.upcomingEvents?.edges ?? [];
    const events: Omit<NormalizedEvent, "id">[] = edges
      .filter((edge) => edge.node.dateTime)
      .map((edge) =>
        toNormalizedEvent({
          title: edge.node.title,
          description: edge.node.description,
          startDateTime: new Date(edge.node.dateTime).toISOString(),
          endDateTime: edge.node.endTime ? new Date(edge.node.endTime).toISOString() : undefined,
          venueName: edge.node.venue?.name,
          address: edge.node.venue?.address,
          city: edge.node.venue?.city,
          url: edge.node.eventUrl,
          sourceName: "Meetup",
          sourceType: "meetup",
        }),
      );

    return { sourceName: "Meetup", events };
  } catch (err) {
    return { sourceName, events: [], error: (err as Error).message };
  }
}
