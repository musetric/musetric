import {
  type AnchorHTMLAttributes,
  type ComponentType,
  type PropsWithChildren,
} from 'react';

type LinkPrams<Params> = keyof Params extends never
  ? { params?: Params }
  : { params: Params };

export type LinkProps<Params> = LinkPrams<Params> &
  AnchorHTMLAttributes<HTMLAnchorElement>;

export type LinkFC<Params> = ComponentType<
  LinkProps<Params> & PropsWithChildren
>;

export const createLink = <Params,>(
  href: (params: Params) => string,
  navigate: (params: Params) => void,
  prefixName?: string,
): LinkFC<Params> => {
  const Link: LinkFC<Params> = (props) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const defaultParams = {} as Params;
    const { params = defaultParams, onClick, children, ...rest } = props;
    const url = href(params);
    return (
      <a
        {...rest}
        href={url}
        onClick={(event) => {
          event.preventDefault();
          navigate(params);
          onClick?.(event);
        }}
      >
        {children}
      </a>
    );
  };
  if (prefixName) {
    Link.displayName = `${prefixName}Link`;
  }
  return Link;
};
