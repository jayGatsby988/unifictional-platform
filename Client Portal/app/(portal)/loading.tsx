export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-32 rounded bg-sand mb-3" />
      <div className="h-9 w-72 rounded bg-sand mb-8" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-paper" />)}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="h-72 rounded-2xl bg-paper lg:col-span-2" />
        <div className="h-72 rounded-2xl bg-paper" />
      </div>
    </div>
  );
}
