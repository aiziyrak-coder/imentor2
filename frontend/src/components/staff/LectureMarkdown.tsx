import React, { useMemo } from 'react';
import Markdown from 'react-markdown';
import { linkifyLectureSources } from '../../utils/linkifyLectureSources';

type Props = {
  children: string;
};

const SOURCE_LINK_CLASS =
  'font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 break-words';

/** Ma'ruza Markdown — `(Manba: …)` iqtiboslari ko'k giperhavola. */
export default function LectureMarkdown({ children }: Props) {
  const content = useMemo(() => linkifyLectureSources(children || ''), [children]);
  return (
    <Markdown
      components={{
        a: ({ href, children: label }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={SOURCE_LINK_CLASS}
          >
            {label}
          </a>
        ),
      }}
    >
      {content}
    </Markdown>
  );
}
