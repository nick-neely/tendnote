import type { Person } from "@tendnote/domain";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PersonCard({ person }: { person: Person }) {
  return (
    <Link href={`/people/${person.id}`}>
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{person.displayName}</CardTitle>
              <CardDescription>{person.relationshipType}</CardDescription>
            </div>
            <ArrowRightIcon aria-hidden className="text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {person.profileBlurb ?? "No profile blurb captured yet."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Closeness {person.closenessLevel}</Badge>
            {person.birthday ? <Badge variant="outline">Birthday saved</Badge> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
